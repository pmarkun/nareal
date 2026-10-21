#include "audio-ring.hpp"
#include <cstdlib>
#include <thread>

int main()
{
    AudioRing ring(257);
    constexpr size_t count = 1000000;
    std::thread producer([&] {
        size_t sent = 0;
        while (sent < count) {
            const auto n = std::min(size_t(32), count - sent);
            if (ring.write(n, [sent](size_t i) { return float(sent + i); }))
                sent += n;
            else
                std::this_thread::yield();
        }
    });
    size_t received = 0;
    while (received < count) {
        auto samples = ring.take(47);
        for (float sample : samples)
            if (sample != float(received++))
                std::abort();
        if (samples.empty())
            std::this_thread::yield();
    }
    producer.join();
    return ring.available() == 0 && ring.readCount() == count && ring.writeCount() == count ? 0 : 1;
}
