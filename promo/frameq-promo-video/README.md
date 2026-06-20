# FrameQ Promo Video

Reset Remotion workspace for the next FrameQ promo concept.

The previous creative direction, scenes, captions, and rendered outputs have been removed. Keep this project as the render shell for the next video.

## Commands

```powershell
npm install
npm run validate:data
npm run dev
npm run still
npm run render
```

The final render is written to `out/frameq-promo.mp4`.
The generated local voiceover is written to `public/voiceover.wav` and is intentionally ignored by git.

Fill `src/promoData.json` with the next approved script, scenes, captions, keywords, and voiceover lines before generating audio or rendering the next real version.
