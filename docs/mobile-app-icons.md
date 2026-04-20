# Mobile App Icon Generation

The app icon + splash screen assets are **not baked into this repo yet** — the
native projects ship with Capacitor's default placeholder icons. Before App
Store / Play submission, regenerate the assets from the brand master.

## Masters

Already in the repo:

- `client/public/brand/golden-note.svg` — vector master (1024×1024 output)
- `resources/icon-only.png` — 1024×1024 PNG rendered from the SVG
- `resources/icon-foreground.png` — same, for Android adaptive foreground
- `resources/splash.png` — 2732×2732 PNG, centered on `#0a0015` background

## Generating icon + splash variants

The Capacitor assets generator pipeline uses `sharp` for image manipulation.
On Node 25 we hit a binary-loading issue (`sharp` pre-builts haven't caught
up to the node_modules layout pnpm uses). Run this on a Node 18–22 environment:

```bash
nvm use 20                    # or any LTS
pnpm install                  # ensures sharp's prebuilt binaries load
npx capacitor-assets generate \
  --iconBackgroundColor "#0a0015" \
  --splashBackgroundColor "#0a0015"
npx cap sync                  # copies generated assets into ios/ and android/
```

This produces:

- `ios/App/App/Assets.xcassets/AppIcon.appiconset/*` — ~15 iOS icon sizes
- `ios/App/App/Assets.xcassets/Splash.imageset/*` — launch storyboard images
- `android/app/src/main/res/mipmap-*/ic_launcher.png` — 5 densities, adaptive
- `android/app/src/main/res/drawable/splash.png`

## Manual override

If you have a finished icon from a designer (preferred — the generated one
from the SVG is programmer-art), drop it in `resources/icon-only.png` as
1024×1024 PNG and re-run the command above.
