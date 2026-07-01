# ASR Benchmark

Measures Whisper transcription accuracy across model sizes. Computes Character Error Rate (CER)
for Mandarin and Word Error Rate (WER) for English.

## Setup

1. Start the ASR service:
   ```bash
   live-translate start
   ```

2. Record audio files and place them in `audio/`. Each WAV file needs a matching `.txt` file
   with the ground-truth transcription.

## Audio file requirements

- Format: WAV, 16 kHz, mono, 16-bit (matches live-translate audio standard)
- Recording command (using sox):
  ```bash
  rec -r 16000 -c 1 -b 16 audio/zh_01.wav trim 0 5
  ```
- Name: any filename, e.g. `zh_01.wav` with `zh_01.txt`

## Suggested sentences to record

**Mandarin (10 sentences):**
```
zh_01.wav → 你好，今天天气怎么样？
zh_02.wav → 我想去超市买一些东西。
zh_03.wav → 请问最近的地铁站在哪里？
zh_04.wav → 这个餐厅的菜很好吃。
zh_05.wav → 我需要预订一间酒店房间。
zh_06.wav → 明天下午三点我有一个会议。
zh_07.wav → 这本书非常有意思，我很喜欢。
zh_08.wav → 请帮我翻译这段话。
zh_09.wav → 我学中文已经学了两年了。
zh_10.wav → 北京是中国的首都。
```

**English (10 sentences):**
```
en_01.wav → Hello, how is the weather today?
en_02.wav → I would like to go to the supermarket.
en_03.wav → Where is the nearest subway station?
en_04.wav → The food at this restaurant is delicious.
en_05.wav → I need to book a hotel room.
en_06.wav → I have a meeting tomorrow afternoon at three.
en_07.wav → This book is very interesting, I really like it.
en_08.wav → Please help me translate this passage.
en_09.wav → I have been studying Chinese for two years.
en_10.wav → Beijing is the capital of China.
```

## Running the benchmark

```bash
# Default: uses ASR service at localhost:8001
npx tsx tests/asr-benchmark/benchmark.ts

# Switch model, then restart and benchmark again
live-translate config --whisper-model onnx-community/whisper-large-v3
live-translate stop && live-translate start
npx tsx tests/asr-benchmark/benchmark.ts
```

## Example output

```
┌─────────────┬──────────┬──────────┬───────────────────────────────────────────────────────┬─────────────────────────────────────────────────────────┬─────────┬──────────┐
│ file        │ language │ metric   │ ground truth                                          │ transcription                                           │ CER/WER │ time(ms) │
├─────────────┼──────────┼──────────┼───────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────┼─────────┼──────────┤
│ zh_01.wav   │ zh       │ CER      │ 你好，今天天气怎么样？                                │ 你好，今天天气怎么样？                                  │ 0.00    │ 1234     │
│ en_01.wav   │ en       │ WER      │ Hello, how is the weather today?                      │ Hello, how is the weather today?                        │ 0.00    │ 987      │
└─────────────┴──────────┴──────────┴───────────────────────────────────────────────────────┴─────────────────────────────────────────────────────────┴─────────┴──────────┘

Summary: 2 files | zh avg CER: 0.00 | en avg WER: 0.00
```
