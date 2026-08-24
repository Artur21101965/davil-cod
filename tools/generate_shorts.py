#!/usr/bin/env python3
"""
generate_shorts.py — генератор шортс-видео через бесплатные онлайн-модели Hugging Face.

Источники:
  1. MiniMax H3  (multimodalart/minimax-h3)  — видео + звук из одного промпта (основной)
  2. Wan 2.1     (Wan-AI/Wan2.1)             — видео без звука (запасной)

Использование:
  ./generate_shorts.py "Cozy morning scene, woman at desk, warm light" --duration 5
  ./generate_shorts.py "Forest path in autumn" --format 9:16 --steps 20 --count 2
  ./generate_shorts.py "промпт" --source wan     # использовать Wan 2.1

Требования: .venv (uv venv .venv && uv pip install --python .venv/bin/python -r requirements.txt)

ВАЖНО: бесплатные демо Hugging Face (ZeroGPU) имеют лимит анонимных запусков.
Чтобы получить больше квоты (бесплатно):
  1. Зарегистрируйся на huggingface.co
  2. https://huggingface.co/settings/tokens → Create token (тип Read)
  3. Экспортируй:  export HF_TOKEN=hf_xxx
"""
import argparse
import os
import sys
import time

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "output")

CANVASES = {
    "9:16": "544x960 · 9:16 fast",      # портрет — для Shorts/Reels/TikTok
    "16:9": "960x544 · 16:9 fast",      # пейзаж — для YouTube
    "1:1": "544x544 · 1:1 fast",        # квадрат — для постов
}

MINIMAX_SPACE = "multimodalart/minimax-h3"
MINIMAX_ULTRA_SPACE = "mrfakename/minimax-h3-ultra-fast"
WAN_SPACE = "Wan-AI/Wan2.1"


def load_client(space):
    from gradio_client import Client
    # HF-токен повышает лимит ZeroGPU (бесплатно). Получить:
    # https://huggingface.co/settings/tokens → Create token → Read
    # Источники: env HF_TOKEN или локальный tools/.env
    hf_token = os.environ.get("HF_TOKEN", "")
    if not hf_token:
        env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
        try:
            for line in open(env_path):
                if line.strip().startswith("HF_TOKEN="):
                    hf_token = line.strip().split("=", 1)[1].strip()
                    break
        except Exception:
            pass
    if hf_token:
        return Client(space, verbose=False, token=hf_token)
    return Client(space, verbose=False)


def generate_minimax(client, prompt, canvas, duration, steps, seed, count, output_dir, space_name="MiniMax H3"):
    """MiniMax H3: видео + звук, 2-14 сек. Автопереключение на ultra-fast при занятой очереди."""
    print(f"[{space_name}] Генерирую {count} видео: {prompt[:60]}...")
    files = []
    for i in range(count):
        s = seed + i if seed else None
        print(f"  [{i + 1}/{count}] промпт + {canvas} + {duration}с (seed={s}) ...")
        try:
            result = client.predict(
                prompt=prompt,
                image_path=None,
                last_image_path=None,
                canvas=canvas,
                duration=duration,
                steps=steps,
                seed=s or 42,
                upsample=False,
                api_name="/generate",
            )
            video = result[0] if isinstance(result, (list, tuple)) else result
            path = video if isinstance(video, str) else getattr(video, "path", None)
            if not path:
                print("    ⚠️ Пустой результат, пропускаю")
                continue
            out = os.path.join(output_dir, f"minimax_{time.strftime('%H%M%S')}_{i}.mp4")
            # gradio_client уже скачивает файл локально; копируем в output
            import shutil
            shutil.copy(path, out)
            files.append(out)
            print(f"    ✅ {out}")
        except Exception as e:
            msg = str(e)
            print(f"    ⚠️ Ошибка: {msg[:120]}")
            # Если очередь/GPU заняты — пробуем ultra-fast один раз
            if "GPU duration" in msg or "queue" in msg.lower() or "busy" in msg.lower():
                print(f"    ↪ Очередь занята, пробую {MINIMAX_ULTRA_SPACE}...")
                try:
                    from gradio_client import Client as GC
                    client2 = GC(MINIMAX_ULTRA_SPACE, verbose=False)
                    result = client2.predict(
                        prompt=prompt,
                        image_path=None,
                        last_image_path=None,
                        canvas=canvas,
                        duration=duration,
                        steps=steps,
                        seed=s or 42,
                        upsample=False,
                        acceleration="Balanced",
                        api_name="/generate",
                    )
                    video = result[0] if isinstance(result, (list, tuple)) else result
                    path = video if isinstance(video, str) else getattr(video, "path", None)
                    if path:
                        out = os.path.join(output_dir, f"minimax_ultra_{time.strftime('%H%M%S')}_{i}.mp4")
                        import shutil
                        shutil.copy(path, out)
                        files.append(out)
                        print(f"    ✅ {out} (ultra-fast)")
                        continue
                except Exception as e2:
                    print(f"    ❌ ultra-fast тоже не сработал: {str(e2)[:100]}")
            print(f"    ❌ Пропуск видео {i + 1}")
    return files


def generate_wan(client, prompt, output_dir):
    """Wan 2.1: видео без звука. Space использует вкладки/события — ограниченная поддержка."""
    print(f"[Wan 2.1] Генерирую: {prompt[:60]}...")
    print("    ⚠️ Официальный Wan2.1 space работает через вкладки (события),")
    print("    не через простой /generate. Рекомендую использовать MiniMax H3 (--source minimax).")
    print("    Альтернатива: запусти Wan локально через ComfyUI (см. prompts.md).")
    return []


def main():
    ap = argparse.ArgumentParser(description="Генератор шортс через бесплатные HF-модели")
    ap.add_argument("prompt", help="Промпт для генерации (см. prompts.md)")
    ap.add_argument("--duration", type=int, default=5, help="Длительность, сек (2-14, MiniMax)")
    ap.add_argument("--format", choices=["9:16", "16:9", "1:1"], default="9:16", help="Формат кадра")
    ap.add_argument("--steps", type=int, default=28, help="Шаги генерации (10-40)")
    ap.add_argument("--seed", type=int, default=None, help="Seed для воспроизводимости")
    ap.add_argument("--count", type=int, default=1, help="Сколько видео")
    ap.add_argument("--source", choices=["minimax", "wan"], default="minimax", help="Модель")
    ap.add_argument("--output", default=OUTPUT_DIR, help="Папка для готовых видео")
    args = ap.parse_args()

    os.makedirs(args.output, exist_ok=True)
    canvas = CANVASES[args.format]

    if args.source == "minimax":
        client = load_client(MINIMAX_SPACE)
        files = generate_minimax(client, args.prompt, canvas, args.duration, args.steps, args.seed, args.count, args.output)
    else:
        client = load_client(WAN_SPACE)
        files = generate_wan(client, args.prompt, args.output)

    print(f"\nГотово: {len(files)} видео")
    for f in files:
        print(f"  {f}")


if __name__ == "__main__":
    main()
