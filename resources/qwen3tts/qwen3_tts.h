#ifndef QWEN3_TTS_H
#define QWEN3_TTS_H

#include <stdint.h>
#include <stddef.h>

#ifdef _WIN32
#  ifdef QWEN3_TTS_EXPORTS
#    define QWEN3_TTS_API __declspec(dllexport)
#  else
#    define QWEN3_TTS_API __declspec(dllimport)
#  endif
#else
#  define QWEN3_TTS_API
#endif

typedef struct {
    uint32_t sample_rate;
    size_t n_fft;
    size_t hop_length;
    size_t win_length;
    size_t n_mels;
    float fmin;
    float fmax;
} Qwen3TtsMelConfig;

QWEN3_TTS_API size_t qwen3_tts_last_error_message(char *out_buf, size_t out_len);

QWEN3_TTS_API size_t qwen3_tts_read_wav_f32(
    const char *path,
    float *out_buf,
    size_t out_len,
    uint32_t *out_sr);

QWEN3_TTS_API int32_t qwen3_tts_write_wav_f32(
    const char *path,
    const float *samples,
    size_t samples_len,
    uint32_t sample_rate);

QWEN3_TTS_API size_t qwen3_tts_resample_f32(
    const float *input,
    size_t input_len,
    uint32_t src_rate,
    uint32_t dst_rate,
    float *out_buf,
    size_t out_len);

QWEN3_TTS_API size_t qwen3_tts_mel_f32(
    const float *input,
    size_t input_len,
    const Qwen3TtsMelConfig *cfg,
    float *out_buf,
    size_t out_len,
    size_t *out_rows,
    size_t *out_cols);

typedef struct Qwen3TtsTokenizerHandle Qwen3TtsTokenizerHandle;

QWEN3_TTS_API Qwen3TtsTokenizerHandle *qwen3_tts_tokenizer_create(
    const char *vocab_path,
    const char *merges_path,
    const char *tokenizer_config_path);

QWEN3_TTS_API void qwen3_tts_tokenizer_free(Qwen3TtsTokenizerHandle *handle);

QWEN3_TTS_API size_t qwen3_tts_tokenizer_encode(
    Qwen3TtsTokenizerHandle *handle,
    const char *text,
    int64_t *out_ids,
    size_t out_len);

QWEN3_TTS_API size_t qwen3_tts_tokenizer_decode(
    Qwen3TtsTokenizerHandle *handle,
    const int64_t *ids,
    size_t ids_len,
    char *out_buf,
    size_t out_len);

QWEN3_TTS_API size_t qwen3_tts_build_ref_text(
    const char *text,
    char *out_buf,
    size_t out_len);

QWEN3_TTS_API size_t qwen3_tts_build_instruct_text(
    const char *text,
    char *out_buf,
    size_t out_len);

QWEN3_TTS_API size_t qwen3_tts_build_assistant_text(
    const char *text,
    char *out_buf,
    size_t out_len);

QWEN3_TTS_API int32_t qwen3_tts_apply_repetition_penalty(
    float *logits,
    size_t vocab,
    const int64_t *history,
    size_t history_len,
    float penalty);

QWEN3_TTS_API int64_t qwen3_tts_sample_next_token(
    const float *logits,
    size_t vocab,
    int32_t do_sample,
    size_t top_k,
    float top_p,
    float temperature,
    uint64_t *rng_state);

#endif
