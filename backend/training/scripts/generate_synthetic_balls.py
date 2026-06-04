import cv2
import numpy as np
import os
import argparse
import random

def draw_motion_blur_ball(
    img: np.ndarray,
    center: tuple,
    radius: int,
    blur_angle: float,
    blur_length: int,
    brightness: float = 1.0,
) -> tuple:
    """
    Draws a motion-blurred yellow tennis ball onto the image.
    Returns the YOLO-format bounding box (class, x_center, y_center, w, h) normalized.
    """
    h, w = img.shape[:2]
    cx, cy = center

    # Create a clean ball on a blank canvas
    ball_canvas = np.zeros_like(img)
    # Tennis ball yellow-green color with slight randomization
    color = (
        int(np.clip(30 + random.gauss(0, 10), 0, 255)),   # B
        int(np.clip(200 * brightness + random.gauss(0, 15), 0, 255)),  # G
        int(np.clip(220 * brightness + random.gauss(0, 15), 0, 255)),  # R
    )
    cv2.circle(ball_canvas, (cx, cy), radius, color, -1, lineType=cv2.LINE_AA)

    # Apply directional motion blur
    kernel_size = max(blur_length, 1)
    kernel = np.zeros((kernel_size, kernel_size), dtype=np.float32)
    mid = kernel_size // 2

    # Draw a line on the kernel at the blur angle
    dx = int(np.cos(blur_angle) * mid)
    dy = int(np.sin(blur_angle) * mid)
    cv2.line(kernel, (mid - dx, mid - dy), (mid + dx, mid + dy), 1.0, 1)
    kernel /= kernel.sum() + 1e-6

    ball_canvas = cv2.filter2D(ball_canvas, -1, kernel)

    # Composite onto the original image
    mask = ball_canvas.sum(axis=2) > 10
    img[mask] = ball_canvas[mask]

    # Compute the bounding box covering the blur streak
    bbox_w = 2 * radius + abs(int(np.cos(blur_angle) * blur_length))
    bbox_h = 2 * radius + abs(int(np.sin(blur_angle) * blur_length))

    # YOLO normalized format
    x_center = cx / w
    y_center = cy / h
    bw = bbox_w / w
    bh = bbox_h / h

    return (0, x_center, y_center, bw, bh)


def generate_synthetic_dataset(
    bg_dir: str,
    out_images_dir: str,
    out_labels_dir: str,
    num_per_bg: int = 10,
):
    """
    Generates synthetic training images with tennis balls composited onto
    empty court backgrounds.
    """
    os.makedirs(out_images_dir, exist_ok=True)
    os.makedirs(out_labels_dir, exist_ok=True)

    bg_files = [
        f for f in os.listdir(bg_dir)
        if f.lower().endswith(('.jpg', '.jpeg', '.png'))
    ]

    if not bg_files:
        print(f"No background images found in {bg_dir}")
        return

    print(f"Found {len(bg_files)} background images. Generating {num_per_bg} samples each...")

    sample_idx = 0
    for bg_file in bg_files:
        bg_path = os.path.join(bg_dir, bg_file)
        bg_img = cv2.imread(bg_path)
        if bg_img is None:
            continue

        h, w = bg_img.shape[:2]

        for _ in range(num_per_bg):
            img = bg_img.copy()

            # Randomize ball parameters
            radius = random.randint(3, 12)
            cx = random.randint(radius + 5, w - radius - 5)
            cy = random.randint(radius + 5, h - radius - 5)
            blur_angle = random.uniform(0, 2 * np.pi)
            blur_length = random.randint(1, 25)
            brightness = random.uniform(0.7, 1.3)

            label = draw_motion_blur_ball(
                img, (cx, cy), radius, blur_angle, blur_length, brightness
            )

            # Add Gaussian noise
            noise = np.random.normal(0, random.uniform(2, 8), img.shape).astype(np.int16)
            img = np.clip(img.astype(np.int16) + noise, 0, 255).astype(np.uint8)

            # JPEG compression artifacts (save & re-read at low quality)
            quality = random.randint(60, 95)
            encode_param = [cv2.IMWRITE_JPEG_QUALITY, quality]

            frame_name = f"synth_{sample_idx:06d}"
            img_path = os.path.join(out_images_dir, f"{frame_name}.jpg")
            label_path = os.path.join(out_labels_dir, f"{frame_name}.txt")

            cv2.imwrite(img_path, img, encode_param)

            with open(label_path, 'w') as f:
                f.write(f"{label[0]} {label[1]:.6f} {label[2]:.6f} {label[3]:.6f} {label[4]:.6f}\n")

            sample_idx += 1

    print(f"Generated {sample_idx} synthetic training samples.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Generate synthetic tennis ball training data."
    )
    parser.add_argument(
        "--bg_dir", type=str, required=True,
        help="Directory containing empty court background images",
    )
    parser.add_argument(
        "--out_images", type=str, required=True,
        help="Output directory for generated images",
    )
    parser.add_argument(
        "--out_labels", type=str, required=True,
        help="Output directory for YOLO labels",
    )
    parser.add_argument(
        "--num_per_bg", type=int, default=10,
        help="Number of synthetic samples to generate per background image",
    )
    args = parser.parse_args()

    generate_synthetic_dataset(
        args.bg_dir, args.out_images, args.out_labels, args.num_per_bg
    )
