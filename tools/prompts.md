# Промпты для шортс (9:16)

Готовые промпты для генерации вертикальных видео через MiniMax H3 / Wan 2.1.
Запуск: `./generate_shorts.py "промпт" --format 9:16 --duration 5`

## Правила хорошего промпта

1. **Движение камеры** — указывай медленный дрейф/плавность (модель любит движение)
2. **Свет** — «warm golden light», «soft morning light» сильно влияют на качество
3. **Длительность** — для шортс: 5-8 сек (2-14 допустимо у MiniMax)
4. **Детали** — окружение, атмосфера, текстуры делают ролик живым
5. **Стиль** — добавляй «cinematic», «premium aesthetic» в конце

## Lifestyle

- `Cozy morning scene, woman at desk with laptop, warm golden light streaming through window, steam rising from coffee cup, slow camera drift right, cinematic quality, 6 seconds`
- `Busy creative workspace, multiple monitors, hands typing, warm ambient light, shallow focus, documentary style`
- `Person walking through city street at golden hour, sunlight flare, slow tracking shot, urban lifestyle, cinematic`

## Природа

- `Forest path in autumn, golden leaves falling, soft morning light, slow forward camera movement, cinematic, peaceful atmosphere`
- `Mountain lake at sunrise, mist over water, birds flying, slow aerial drift, breathtaking nature, 4K quality`
- `Ocean waves crashing on rocky coast, dramatic clouds, slow pan, powerful nature scene, cinematic`

## Продукты

- `Elegant product placement on marble surface, soft diffused studio lighting, slow 180 degree orbit, depth of field, premium aesthetic`
- `Cosmetic bottle with water splash, studio macro shot, slow rotation, luxury branding, clean background`
- `Coffee cup on wooden table, steam rising, warm side light, slow push-in, cozy product shot`

## Абстракции / фоны

- `Abstract geometric shapes, warm color palette, slow rotation, premium minimal aesthetic, suitable as background`
- `Liquid gold ink swirling in water, slow motion, luxurious abstract background, deep black backdrop`
- `Soft bokeh lights drifting, dreamy pastel colors, slow camera move, calming abstract background`

## Мода / стиль

- `Fashion model in flowing dress, studio with dramatic lighting, slow camera orbit, high fashion editorial`
- `Sneaker close-up rotating slowly, dramatic rim light, urban background bokeh, product hero shot`
- `Jewelry macro, sparkling gemstone rotating, dark studio, light reflections, luxury close-up`

## Полезные советы

- Для стабильности используй один seed: `--seed 42`
- Для быстрой проверки: `--steps 10 --duration 3`
- Для финального качества: `--steps 28 --duration 7`
- Если демо занято (очередь) — подожди или задай `HF_TOKEN` (см. generate_shorts.py)
