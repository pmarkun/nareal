#include <obs-module.h>
#include <obs-frontend-api.h>
#include <media-io/audio-resampler.h>
#include <QComboBox>
#include <QClipboard>
#include <QGuiApplication>
#include <QDesktopServices>
#include <QHBoxLayout>
#include <QJsonDocument>
#include <QJsonObject>
#include <QLabel>
#include <QLineEdit>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QPointer>
#include <QPushButton>
#include <QSpinBox>
#include <QTimer>
#include <QUrl>
#include <QVBoxLayout>
#include <QWidget>
#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <memory>
#include <vector>
#include "audio-ring.hpp"

OBS_DECLARE_MODULE()
MODULE_EXPORT const char *obs_module_description(void)
{
    return "Na Real: captura local de áudio, checagem e overlay com revisão.";
}

namespace {
constexpr const char *dockId = "nareal-capture";

class CaptureDock final : public QWidget {
    QComboBox *sources = new QComboBox(this);
    QSpinBox *port = new QSpinBox(this);
    QLineEdit *key = new QLineEdit(this);
    QPushButton *toggle = new QPushButton("Iniciar captura", this);
    QLabel *status = new QLabel("Abra o serviço local e carregue o Whisper no painel.", this);
    QNetworkAccessManager network;
    QTimer timer;
    obs_source_t *source = nullptr;
    audio_resampler_t *resampler = nullptr;
    std::unique_ptr<AudioRing> ring;
    std::atomic<bool> overflow{false};
    uint32_t sampleRate = 48000;
    size_t channels = 2;
    int sequence = 0;
    QString session;
    bool inFlight = false, starting = false, stopping = false;

    QString base() const { return QString("http://127.0.0.1:%1").arg(port->value()); }

    QNetworkRequest request(const QString &path, const QByteArray &type = "application/json")
    {
        QNetworkRequest req(QUrl(base() + path));
        req.setHeader(QNetworkRequest::ContentTypeHeader, type);
        req.setRawHeader("Authorization", "Bearer " + key->text().trimmed().toUtf8());
        req.setTransferTimeout(5000);
        req.setAttribute(QNetworkRequest::RedirectPolicyAttribute, QNetworkRequest::ManualRedirectPolicy);
        return req;
    }

    static QString error(QNetworkReply *reply)
    {
        auto detail = QJsonDocument::fromJson(reply->readAll()).object().value("detail").toString();
        return detail.isEmpty() ? "Serviço local indisponível. Confira a porta e a chave." : detail;
    }

    // OBS invokes this on its audio thread: no HTTP, UI work or waiting here.
    static void capture(void *data, obs_source_t *, const audio_data *audio, bool muted)
    {
        auto *self = static_cast<CaptureDock *>(data);
        const bool copied = self->ring->write(audio->frames, [self, audio, muted](size_t frame) {
            float mono = 0;
            if (!muted) {
                for (size_t channel = 0; channel < self->channels; ++channel) {
                    if (audio->data[channel])
                        mono += reinterpret_cast<const float *>(audio->data[channel])[frame];
                }
                mono /= float(self->channels);
            }
            return std::isfinite(mono) ? std::clamp(mono, -1.0f, 1.0f) : 0.0f;
        });
        if (!copied)
            self->overflow.store(true);
    }

    void controls(bool running)
    {
        sources->setEnabled(!running);
        port->setEnabled(!running);
        key->setEnabled(!running);
        toggle->setText(running ? "Parar captura" : "Iniciar captura");
    }

    void detachCapture()
    {
        timer.stop();
        if (source) {
            obs_source_remove_audio_capture_callback(source, capture, this);
            obs_source_release(source);
            source = nullptr;
        }
    }

    void releaseCapture()
    {
        detachCapture();
        if (resampler) {
            audio_resampler_destroy(resampler);
            resampler = nullptr;
        }
        ring.reset();
        overflow.store(false);
    }

    void finishStop()
    {
        if (inFlight || session.isEmpty())
            return;
        if (ring && ring->available()) {
            pump(true);
            return;
        }
        if (resampler) {
            audio_resampler_destroy(resampler);
            resampler = nullptr;
        }
        ring.reset();
        auto ident = session;
        session.clear();
        auto *reply = network.post(request("/api/session/" + ident + "/stop"), "{}");
        connect(reply, &QNetworkReply::finished, this, [this, reply] {
            if (reply->error() != QNetworkReply::NoError)
                status->setText(error(reply) + " Reinicie o serviço antes de uma nova captura.");
            stopping = false;
            controls(false);
            toggle->setEnabled(true);
            reply->deleteLater();
        });
    }

    void pump(bool final = false)
    {
        if ((!source && !final) || inFlight || !resampler)
            return;
        if (overflow.load() || (source && obs_source_removed(source))) {
            stop("Captura interrompida: perda de áudio ou fonte removida. Aguarde e reinicie.", true);
            return;
        }
        if (!ring || !ring->available() || (!final && ring->available() < sampleRate / 2))
            return;
        const uint64_t start = ring->readCount();
        auto audio = ring->take(sampleRate);
        uint8_t *output[MAX_AV_PLANES] = {};
        const uint8_t *input[MAX_AV_PLANES] = {};
        input[0] = reinterpret_cast<const uint8_t *>(audio.data());
        uint32_t frames = 0;
        uint64_t offset = 0;
        if (!audio_resampler_resample(resampler, output, &frames, &offset, input, uint32_t(audio.size()))) {
            stop("Não foi possível converter o áudio para 16 kHz.");
            return;
        }
        if (!frames) {
            if (final)
                finishStop();
            return;
        }
        auto req = request("/api/audio", "application/octet-stream");
        req.setRawHeader("X-Session", session.toUtf8());
        req.setRawHeader("X-Sequence", QByteArray::number(sequence++));
        req.setRawHeader("X-Start-Ms", QByteArray::number(qulonglong(start * 1000 / sampleRate)));
        // OBS-supported desktop platforms are little-endian; Float32 is the IPC contract.
        auto *reply = network.post(req, QByteArray(reinterpret_cast<const char *>(output[0]), int(frames * sizeof(float))));
        inFlight = true;
        connect(reply, &QNetworkReply::finished, this, [this, reply] {
            inFlight = false;
            if (reply->error() != QNetworkReply::NoError) {
                auto message = error(reply);
                releaseCapture();
                stopping = true;
                toggle->setEnabled(false);
                status->setText(message + " A captura foi interrompida.");
            } else if (!stopping) {
                status->setText("Áudio enviado localmente · " + QString::number(ring ? ring->writeCount() / sampleRate : 0) + "s. Revise no painel.");
            }
            reply->deleteLater();
            if (stopping)
                finishStop();
        });
    }

    void start()
    {
        if (starting || stopping || source)
            return;
        if (key->text().trimmed().size() < 24 || sources->currentText().isEmpty()) {
            status->setText("Selecione uma fonte e cole a chave do serviço local.");
            return;
        }
        starting = true;
        toggle->setEnabled(false);
        controls(true);
        const auto name = sources->currentText();
        auto *reply = network.post(request("/api/session"), QJsonDocument(QJsonObject{{"source", name}}).toJson());
        connect(reply, &QNetworkReply::finished, this, [this, reply, name] {
            starting = false;
            toggle->setEnabled(true);
            if (reply->error() != QNetworkReply::NoError) {
                status->setText(error(reply));
                controls(false);
                reply->deleteLater();
                return;
            }
            session = QJsonDocument::fromJson(reply->readAll()).object().value("id").toString();
            reply->deleteLater();
            source = obs_get_source_by_name(name.toUtf8().constData());
            obs_audio_info info{};
            if (session.isEmpty() || !source || !obs_get_audio_info(&info)) {
                stop("A fonte de áudio não está mais disponível.");
                return;
            }
            sampleRate = info.samples_per_sec;
            channels = get_audio_channels(info.speakers);
            resample_info from{};
            from.samples_per_sec = sampleRate;
            from.format = AUDIO_FORMAT_FLOAT;
            from.speakers = SPEAKERS_MONO;
            resample_info to{};
            to.samples_per_sec = 16000;
            to.format = AUDIO_FORMAT_FLOAT;
            to.speakers = SPEAKERS_MONO;
            resampler = audio_resampler_create(&to, &from);
            if (!resampler || !channels) {
                stop("Formato de áudio não suportado.");
                return;
            }
            ring = std::make_unique<AudioRing>(sampleRate * 3);
            sequence = 0;
            overflow.store(false);
            obs_source_add_audio_capture_callback(source, capture, this);
            timer.start(100);
            status->setText("Capturando: " + name + ". Abra o painel para revisar.");
        });
    }

public:
    CaptureDock()
    {
        auto *layout = new QVBoxLayout(this);
        auto *refresh = new QPushButton("Atualizar fontes", this);
        auto *panel = new QPushButton("Abrir revisão e configurar IA", this);
        auto *overlay = new QPushButton("Copiar URL do overlay", this);
        port->setRange(1024, 65535);
        port->setValue(8766);
        key->setEchoMode(QLineEdit::Password);
        key->setPlaceholderText("Chave local do operador");
        status->setWordWrap(true);
        layout->addWidget(new QLabel("Na Real · fonte de áudio", this));
        layout->addWidget(sources);
        layout->addWidget(refresh);
        layout->addWidget(new QLabel("Porta do serviço local", this));
        layout->addWidget(port);
        layout->addWidget(key);
        layout->addWidget(toggle);
        layout->addWidget(panel);
        layout->addWidget(overlay);
        layout->addWidget(status);
        layout->addStretch();
        connect(refresh, &QPushButton::clicked, this, [this] { refreshSources(); });
        connect(toggle, &QPushButton::clicked, this, [this] { source ? stop("Captura encerrada. Finalizando a última fala.") : start(); });
        connect(panel, &QPushButton::clicked, this, [this] {
            QUrl url(base() + "/");
            url.setFragment("token=" + key->text().trimmed());
            QDesktopServices::openUrl(url);
        });
        connect(overlay, &QPushButton::clicked, this, [this] {
            // No credential is included in the read-only overlay URL.
            QGuiApplication::clipboard()->setText(base() + "/overlay");
            status->setText("URL copiada. Adicione uma Fonte de navegador em 1920 × 1080.");
        });
        connect(&timer, &QTimer::timeout, this, [this] { pump(); });
        refreshSources();
    }

    ~CaptureDock() override { releaseCapture(); }

    void refreshSources()
    {
        if (source || starting || stopping)
            return;
        const auto selected = sources->currentText();
        sources->clear();
        obs_enum_sources([](void *data, obs_source_t *item) {
            if (obs_source_get_output_flags(item) & OBS_SOURCE_AUDIO)
                static_cast<QComboBox *>(data)->addItem(QString::fromUtf8(obs_source_get_name(item)));
            return true;
        }, sources);
        const int index = sources->findText(selected);
        if (index >= 0)
            sources->setCurrentIndex(index);
    }

    void stop(const QString &message, bool discard = false)
    {
        if (stopping)
            return;
        // Detach the audio callback, drain bounded pending audio, then flush ASR.
        if (discard)
            releaseCapture();
        else
            detachCapture();
        stopping = true;
        toggle->setEnabled(false);
        status->setText(message);
        if (session.isEmpty()) {
            stopping = false;
            controls(false);
            toggle->setEnabled(true);
        } else {
            finishStop();
        }
    }
};

QPointer<CaptureDock> dock;

void frontendEvent(enum obs_frontend_event event, void *)
{
    if (dock && (event == OBS_FRONTEND_EVENT_EXIT || event == OBS_FRONTEND_EVENT_SCENE_COLLECTION_CHANGING))
        dock->stop("Captura encerrada por mudança de coleção ou saída do OBS.");
}
}

bool obs_module_load(void)
{
    dock = new CaptureDock();
    if (!obs_frontend_add_dock_by_id(dockId, "Na Real", dock)) {
        delete dock;
        return false;
    }
    obs_frontend_add_event_callback(frontendEvent, nullptr);
    return true;
}

void obs_module_unload(void)
{
    obs_frontend_remove_event_callback(frontendEvent, nullptr);
    if (dock) {
        dock->stop("Plugin encerrado.");
        obs_frontend_remove_dock(dockId);
        if (dock)
            delete dock;
    }
}
