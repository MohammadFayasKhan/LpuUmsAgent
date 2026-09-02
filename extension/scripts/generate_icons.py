import math
import os
from PIL import Image, ImageDraw, ImageFilter

def create_onee_icon(size: int) -> Image.Image:
    # Render at 4x resolution for super-sampled anti-aliasing
    scale = 4
    canvas_size = size * scale
    img = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    pad = 4 * scale
    radius = (canvas_size - 2 * pad) * 0.225
    x0, y0 = pad, pad
    x1, y1 = canvas_size - pad, canvas_size - pad

    # 1. Base Squircle / Rounded Rect with subtle gradient
    base_mask = Image.new("L", (canvas_size, canvas_size), 0)
    base_draw = ImageDraw.Draw(base_mask)
    base_draw.rounded_rectangle([x0, y0, x1, y1], radius=radius, fill=255)

    # Create vertical gradient for background: #1a0836 -> #090314
    bg = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    for y in range(canvas_size):
        ratio = y / canvas_size
        r = int(26 * (1 - ratio) + 11 * ratio)
        g = int(10 * (1 - ratio) + 4 * ratio)
        b = int(58 * (1 - ratio) + 26 * ratio)
        line_draw = ImageDraw.Draw(bg)
        line_draw.line([(0, y), (canvas_size, y)], fill=(r, g, b, 255))
    
    # Apply mask to background
    bg.putalpha(base_mask)
    img.paste(bg, (0, 0), bg)

    # 2. Outer Rim Light Stroke (Electric Violet #7c3aed to #a78bfa)
    stroke_w = max(2, int(1.5 * scale))
    draw.rounded_rectangle(
        [x0 + stroke_w // 2, y0 + stroke_w // 2, x1 - stroke_w // 2, y1 - stroke_w // 2],
        radius=radius,
        outline=(124, 58, 237, 210),
        width=stroke_w
    )

    cx, cy = canvas_size / 2, canvas_size / 2

    # 3. Outer ONEE "O" Glow Ring
    o_outer_r = (canvas_size - 2 * pad) * 0.35
    o_width = max(2, int(3.5 * scale))

    # Glow layer
    glow = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    glow_draw.ellipse(
        [cx - o_outer_r, cy - o_outer_r, cx + o_outer_r, cy + o_outer_r],
        outline=(167, 139, 250, 160),
        width=int(5 * scale)
    )
    glow = glow.filter(ImageFilter.GaussianBlur(int(2 * scale)))
    img.paste(glow, (0, 0), glow)

    # Main "O" Primary Ring
    draw.ellipse(
        [cx - o_outer_r, cy - o_outer_r, cx + o_outer_r, cy + o_outer_r],
        outline=(139, 92, 246, 255),
        width=o_width
    )

    # 4. Precision Computer-Use Corner Brackets / Vision Crosshairs
    bracket_r = o_outer_r * 1.25
    b_len = int(3.5 * scale)
    b_w = max(1, int(1.5 * scale))
    b_color = (196, 181, 253, 220)

    # Top-Left Bracket
    draw.line([(cx - bracket_r, cy - bracket_r), (cx - bracket_r + b_len, cy - bracket_r)], fill=b_color, width=b_w)
    draw.line([(cx - bracket_r, cy - bracket_r), (cx - bracket_r, cy - bracket_r + b_len)], fill=b_color, width=b_w)

    # Top-Right Bracket
    draw.line([(cx + bracket_r, cy - bracket_r), (cx + bracket_r - b_len, cy - bracket_r)], fill=b_color, width=b_w)
    draw.line([(cx + bracket_r, cy - bracket_r), (cx + bracket_r, cy - bracket_r + b_len)], fill=b_color, width=b_w)

    # Bottom-Left Bracket
    draw.line([(cx - bracket_r, cy + bracket_r), (cx - bracket_r + b_len, cy + bracket_r)], fill=b_color, width=b_w)
    draw.line([(cx - bracket_r, cy + bracket_r), (cx - bracket_r, cy + bracket_r - b_len)], fill=b_color, width=b_w)

    # Bottom-Right Bracket
    draw.line([(cx + bracket_r, cy + bracket_r), (cx + bracket_r - b_len, cy + bracket_r)], fill=b_color, width=b_w)
    draw.line([(cx + bracket_r, cy + bracket_r), (cx + bracket_r, cy + bracket_r - b_len)], fill=b_color, width=b_w)

    # 5. Inner Intelligent Iris / Lens (Cyan to Emerald glowing core)
    iris_r = (canvas_size - 2 * pad) * 0.14
    draw.ellipse(
        [cx - iris_r, cy - iris_r, cx + iris_r, cy + iris_r],
        fill=(16, 185, 129, 255)
    )

    # Iris inner highlight ring
    iris_ring_r = iris_r * 0.65
    draw.ellipse(
        [cx - iris_ring_r, cy - iris_ring_r, cx + iris_ring_r, cy + iris_ring_r],
        fill=(255, 255, 255, 255)
    )

    # 6. Subtle Spark / High-tech Glimmer
    glim_r = max(1, int(1.5 * scale))
    draw.ellipse(
        [cx + o_outer_r * 0.55 - glim_r, cy - o_outer_r * 0.55 - glim_r, cx + o_outer_r * 0.55 + glim_r, cy - o_outer_r * 0.55 + glim_r],
        fill=(255, 255, 255, 230)
    )

    # Downsample cleanly to target size with Lanczos filter
    final_img = img.resize((size, size), Image.Resampling.LANCZOS)
    return final_img

if __name__ == "__main__":
    for target_dir in ["public/icons", "dist/icons"]:
        os.makedirs(target_dir, exist_ok=True)
        for size in [16, 32, 48, 128]:
            icon = create_onee_icon(size)
            path = os.path.join(target_dir, f"icon-{size}.png")
            icon.save(path, "PNG")
            print(f"Generated {path} ({size}x{size})")
