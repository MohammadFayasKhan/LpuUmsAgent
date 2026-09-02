import math
import os
from PIL import Image, ImageDraw, ImageFilter

def draw_sleek_pointer(size: int, tip_x: float, tip_y: float, scale_factor: float = 1.0, angle_deg: float = -20) -> Image.Image:
    """
    Renders a high-precision, modern AI Agent cursor pointer with soft glow and crisp border.
    """
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    
    # 4x high-res supersampling for pointer geometry
    ss = 4
    ss_size = size * ss
    ss_layer = Image.new("RGBA", (ss_size, ss_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(ss_layer)

    # Pointer base polygon coordinates relative to tip (0, 0)
    # Scaled by ~75px at 1024 base
    s = 2.4 * scale_factor * ss
    raw_points = [
        (0.0, 0.0),       # Tip
        (0.0, 28.0 * s),  # Left edge
        (7.5 * s, 21.0 * s), # Inner crook
        (13.0 * s, 34.0 * s), # Tail left
        (18.5 * s, 31.5 * s), # Tail bottom
        (13.0 * s, 18.5 * s), # Tail right
        (22.0 * s, 18.5 * s), # Right wing
    ]

    rad = math.radians(angle_deg)
    cos_a, sin_a = math.cos(rad), math.sin(rad)

    # Rotate and translate points to target tip position
    tx, ty = tip_x * ss, tip_y * ss
    transformed_points = []
    for px, py in raw_points:
        rx = px * cos_a - py * sin_a + tx
        ry = px * sin_a + py * cos_a + ty
        transformed_points.append((rx, ry))

    # 1. Soft Ambient Orange Neon Glow
    glow_layer = Image.new("RGBA", (ss_size, ss_size), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow_layer)
    glow_draw.polygon(transformed_points, fill=(249, 115, 22, 220))
    glow_layer = glow_layer.filter(ImageFilter.GaussianBlur(int(9 * ss)))
    ss_layer.alpha_composite(glow_layer)

    # 2. Crisp White Outer Rim / Border (for maximum visibility & contrast)
    stroke_w = int(3.2 * ss)
    # Draw thicker white background polygon
    draw.polygon(transformed_points, fill=(255, 255, 255, 255), outline=(255, 255, 255, 255), width=stroke_w)

    # 3. Vibrant High-Tech Orange Fill with subtle gradient
    inner_points = []
    # Slightly inset for crisp inner fill
    for px, py in raw_points:
        # Inset towards centroid
        rx = px * cos_a - py * sin_a + tx
        ry = px * sin_a + py * cos_a + ty
        inner_points.append((rx, ry))

    draw.polygon(inner_points, fill=(249, 115, 22, 255))

    # 4. Subtle Inner Glow / Highlight Core
    draw.line(
        [transformed_points[0], transformed_points[1]],
        fill=(255, 237, 213, 230),
        width=int(1.5 * ss)
    )

    # 5. Glowing Precision Action Dot at Tip
    tip_dot_r = int(5.5 * ss)
    draw.ellipse(
        [tx - tip_dot_r, ty - tip_dot_r, tx + tip_dot_r, ty + tip_dot_r],
        fill=(255, 255, 255, 255),
        outline=(249, 115, 22, 255),
        width=int(1.5 * ss)
    )

    # Downsample back to size with Lanczos
    return ss_layer.resize((size, size), Image.Resampling.LANCZOS)

def generate_master_onee_icon() -> Image.Image:
    # 1024x1024 master canvas
    size = 1024
    master = Image.new("RGBA", (size, size), (0, 0, 0, 0))

    # Padding and squircle geometry
    pad = 40
    radius = 210
    x0, y0 = pad, pad
    x1, y1 = size - pad, size - pad

    # 1. Base Squircle Mask
    squircle_mask = Image.new("L", (size, size), 0)
    s_draw = ImageDraw.Draw(squircle_mask)
    s_draw.rounded_rectangle([x0, y0, x1, y1], radius=radius, fill=255)

    # 2. Rich Deep Purple Cosmic Gradient Background
    bg = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    for y in range(size):
        ratio = y / size
        t = ratio * ratio * (3 - 2 * ratio)
        r = int(48 * (1 - t) + 12 * t)
        g = int(14 * (1 - t) + 3 * t)
        b = int(88 * (1 - t) + 26 * t)
        line_draw = ImageDraw.Draw(bg)
        line_draw.line([(0, y), (size, y)], fill=(r, g, b, 255))

    bg.putalpha(squircle_mask)
    master.paste(bg, (0, 0), bg)

    # 3. Soft Ambient Back-Glow Behind ONEE
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    g_draw = ImageDraw.Draw(glow)
    cx, cy = size // 2, size // 2 + 10
    g_radius = 290
    g_draw.ellipse(
        [cx - g_radius, cy - g_radius, cx + g_radius, cy + g_radius],
        fill=(124, 58, 237, 120)
    )
    glow = glow.filter(ImageFilter.GaussianBlur(55))
    glow.putalpha(Image.composite(glow.split()[3], squircle_mask, squircle_mask))
    master.alpha_composite(glow)

    # 4. Squircle Rim Light Border
    draw = ImageDraw.Draw(master)
    stroke_w = 4
    draw.rounded_rectangle(
        [x0 + stroke_w // 2, y0 + stroke_w // 2, x1 - stroke_w // 2, y1 - stroke_w // 2],
        radius=radius,
        outline=(167, 139, 250, 150),
        width=stroke_w
    )

    # 5. Extract and Process the Reference ONEE Character
    ref_path = "src/onee-snapshot.png"
    if not os.path.exists(ref_path):
        ref_path = os.path.join(os.path.dirname(__file__), "../src/onee-snapshot.png")

    ref_img = Image.open(ref_path).convert("RGBA")
    bbox = ref_img.getbbox()
    cropped_onee = ref_img.crop(bbox)

    # Target: Fill ~78% of the squircle width
    target_w = int((size - 2 * pad) * 0.78)
    scale_factor = target_w / cropped_onee.width
    target_h = int(cropped_onee.height * scale_factor)

    resized_onee = cropped_onee.resize((target_w, target_h), Image.Resampling.LANCZOS)

    # Position ONEE centered perfectly in the squircle
    onee_x = (size - target_w) // 2
    onee_y = (size - target_h) // 2 + 8  # slight optical compensation

    # 6. Smooth Ambient Drop Shadow Under ONEE
    shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    onee_alpha = resized_onee.split()[3]
    shadow_layer = Image.new("RGBA", (target_w, target_h), (0, 0, 0, 160))
    shadow_layer.putalpha(onee_alpha)

    shadow.paste(shadow_layer, (onee_x + 6, onee_y + 24), shadow_layer)
    shadow = shadow.filter(ImageFilter.GaussianBlur(18))
    master.alpha_composite(shadow)

    # 7. Composite ONEE Character onto Canvas
    master.paste(resized_onee, (onee_x, onee_y), resized_onee)

    # 8. High-Tech Glowing Orange AI Cursor Pointer
    # Position the pointer on ONEE's upper-right contour pointing dynamically
    pointer_tip_x = onee_x + int(target_w * 0.73)
    pointer_tip_y = onee_y + int(target_h * 0.14)

    pointer_layer = draw_sleek_pointer(
        size=size,
        tip_x=pointer_tip_x,
        tip_y=pointer_tip_y,
        scale_factor=1.15,
        angle_deg=-28 # Angled dynamically as an active agent pointer
    )

    master.alpha_composite(pointer_layer)
    return master

if __name__ == "__main__":
    master_icon = generate_master_onee_icon()
    
    # Save 1024x1024 Master Artwork
    master_path = "public/icons/onee-master-1024.png"
    os.makedirs("public/icons", exist_ok=True)
    os.makedirs("dist/icons", exist_ok=True)
    master_icon.save(master_path, "PNG")
    print(f"Generated {master_path} (1024x1024)")

    # Downsample cleanly to 128, 48, 32, 16
    for size in [128, 48, 32, 16]:
        scaled = master_icon.resize((size, size), Image.Resampling.LANCZOS)
        
        pub_p = f"public/icons/icon-{size}.png"
        dist_p = f"dist/icons/icon-{size}.png"
        
        scaled.save(pub_p, "PNG")
        scaled.save(dist_p, "PNG")
        print(f"Generated {pub_p} & {dist_p} ({size}x{size})")
