import { join } from "node:path";
import { GlobalFonts } from "@napi-rs/canvas";

// The slim runtime image and current CI runners ship no system fonts, so text drawn
// with "sans-serif" silently rendered nothing. Bundle DejaVu Sans under that alias.
const FONT_DIR = join(import.meta.dir, "..", "assets", "fonts");

GlobalFonts.registerFromPath(join(FONT_DIR, "DejaVuSans.ttf"), "sans-serif");
GlobalFonts.registerFromPath(join(FONT_DIR, "DejaVuSans-Bold.ttf"), "sans-serif");
