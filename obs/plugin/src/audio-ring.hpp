#pragma once
#include <algorithm>
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <vector>

// One OBS source callback produces; the Qt thread consumes. No locks/allocations
// on the audio thread. Published positions use acquire/release ownership.
class AudioRing {
    std::vector<float> samples;
    std::atomic<uint64_t> written{0}, read{0};
public:
    explicit AudioRing(size_t capacity) : samples(capacity) {}
    size_t available() const { return size_t(written.load(std::memory_order_acquire) - read.load(std::memory_order_relaxed)); }
    uint64_t readCount() const { return read.load(std::memory_order_relaxed); }
    uint64_t writeCount() const { return written.load(std::memory_order_acquire); }
    template<class Sample> bool write(size_t count, Sample sample)
    {
        const auto w = written.load(std::memory_order_relaxed);
        const auto r = read.load(std::memory_order_acquire);
        if (w - r + count > samples.size())
            return false;
        for (size_t i = 0; i < count; ++i)
            samples[(w + i) % samples.size()] = sample(i);
        written.store(w + count, std::memory_order_release);
        return true;
    }
    std::vector<float> take(size_t limit)
    {
        const auto r = read.load(std::memory_order_relaxed);
        const auto w = written.load(std::memory_order_acquire);
        const auto count = std::min(limit, size_t(w - r));
        std::vector<float> result(count);
        for (size_t i = 0; i < count; ++i)
            result[i] = samples[(r + i) % samples.size()];
        read.store(r + count, std::memory_order_release);
        return result;
    }
};
