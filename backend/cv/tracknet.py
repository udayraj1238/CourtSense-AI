"""
TrackNetV2 — Temporal Heatmap Ball Detector

Architecture: U-Net encoder-decoder that takes 3 consecutive frames (9 channels)
and outputs a 2D Gaussian heatmap centered on the ball position.

Reference: "TrackNet: A Deep Learning Network for Tracking High-speed and Tiny Objects in Sport Applications"
           — Yu-Chuan Huang et al.

Usage:
    model = TrackNetV2()
    heatmap = model(input_tensor)  # input: (B, 9, 288, 512), output: (B, 1, 288, 512)
    u, v = heatmap_to_centroid(heatmap[0, 0])
"""

import os
import logging
import numpy as np

logger = logging.getLogger(__name__)

try:
    import torch
    import torch.nn as nn
    import torch.nn.functional as F
    TORCH_AVAILABLE = True
except ImportError:
    TORCH_AVAILABLE = False
    logger.warning("PyTorch not available — TrackNet will be disabled.")


def _build_model():
    """Only called when PyTorch is available."""

    class ConvBlock(nn.Module):
        """Double convolution block used in the U-Net encoder/decoder."""
        def __init__(self, in_ch, out_ch):
            super().__init__()
            self.conv = nn.Sequential(
                nn.Conv2d(in_ch, out_ch, 3, padding=1, bias=False),
                nn.BatchNorm2d(out_ch),
                nn.ReLU(inplace=True),
                nn.Conv2d(out_ch, out_ch, 3, padding=1, bias=False),
                nn.BatchNorm2d(out_ch),
                nn.ReLU(inplace=True),
            )

        def forward(self, x):
            return self.conv(x)

    class TrackNetV2(nn.Module):
        """
        9-channel input (3 consecutive RGB frames) → 1-channel heatmap output.
        
        Encoder: 4 downsample blocks (9→64→128→256→512)
        Decoder: 4 upsample blocks with skip connections (512→256→128→64→1)
        """
        def __init__(self):
            super().__init__()

            # Encoder
            self.enc1 = ConvBlock(9, 64)
            self.enc2 = ConvBlock(64, 128)
            self.enc3 = ConvBlock(128, 256)
            self.enc4 = ConvBlock(256, 512)
            self.pool = nn.MaxPool2d(2)

            # Decoder
            self.up4 = nn.ConvTranspose2d(512, 256, 2, stride=2)
            self.dec4 = ConvBlock(512, 256)
            self.up3 = nn.ConvTranspose2d(256, 128, 2, stride=2)
            self.dec3 = ConvBlock(256, 128)
            self.up2 = nn.ConvTranspose2d(128, 64, 2, stride=2)
            self.dec2 = ConvBlock(128, 64)

            # Output
            self.out_conv = nn.Conv2d(64, 1, 1)

        def forward(self, x):
            # Encoder path
            e1 = self.enc1(x)
            e2 = self.enc2(self.pool(e1))
            e3 = self.enc3(self.pool(e2))
            e4 = self.enc4(self.pool(e3))

            # Decoder path with skip connections
            d4 = self.up4(e4)
            d4 = self._pad_and_cat(d4, e3)
            d4 = self.dec4(d4)

            d3 = self.up3(d4)
            d3 = self._pad_and_cat(d3, e2)
            d3 = self.dec3(d3)

            d2 = self.up2(d3)
            d2 = self._pad_and_cat(d2, e1)
            d2 = self.dec2(d2)

            return torch.sigmoid(self.out_conv(d2))

        @staticmethod
        def _pad_and_cat(upsampled, skip):
            """Handle size mismatches from odd dimensions during pooling."""
            dy = skip.size(2) - upsampled.size(2)
            dx = skip.size(3) - upsampled.size(3)
            upsampled = F.pad(upsampled, [dx // 2, dx - dx // 2, dy // 2, dy - dy // 2])
            return torch.cat([upsampled, skip], dim=1)

    return TrackNetV2


def heatmap_to_centroid(heatmap: np.ndarray, threshold: float = 0.5):
    """
    Extract the ball centroid (u, v) from a 2D heatmap.
    
    Args:
        heatmap: 2D numpy array (H, W) with values in [0, 1].
        threshold: Minimum peak value to consider a valid detection.
        
    Returns:
        (u, v) sub-pixel centroid or None if no detection.
    """
    if heatmap.max() < threshold:
        return None

    # Threshold and find the weighted centroid
    mask = (heatmap > threshold).astype(np.float32)
    weighted = heatmap * mask

    total = weighted.sum()
    if total < 1e-6:
        return None

    ys, xs = np.mgrid[0:heatmap.shape[0], 0:heatmap.shape[1]]
    u = float((xs * weighted).sum() / total)
    v = float((ys * weighted).sum() / total)

    return (u, v)


class TrackNetInference:
    """
    High-level inference wrapper for TrackNet.
    
    Loads pre-trained weights if available, otherwise logs a warning
    and allows the system to fall back to YOLO-only ball detection.
    """

    INPUT_H = 288
    INPUT_W = 512

    def __init__(self, weights_path: str = None):
        self.model = None
        self.device = "cpu"

        if not TORCH_AVAILABLE:
            logger.warning("TrackNet disabled: PyTorch not installed.")
            return

        TrackNetV2 = _build_model()
        self.model = TrackNetV2()

        if weights_path and os.path.isfile(weights_path):
            logger.info(f"Loading TrackNet weights from {weights_path}")
            state = torch.load(weights_path, map_location="cpu")
            self.model.load_state_dict(state)
            logger.info("TrackNet weights loaded successfully.")
        else:
            logger.warning(
                "No TrackNet weights found — model is randomly initialized. "
                "Ball tracking will fall back to YOLO-only detection."
            )

        if torch.cuda.is_available():
            self.device = "cuda"
        self.model = self.model.to(self.device).eval()

    @property
    def is_available(self) -> bool:
        return self.model is not None

    def predict(self, frame_prev: np.ndarray, frame_curr: np.ndarray, frame_next: np.ndarray):
        """
        Run inference on 3 consecutive frames.
        
        Args:
            frame_prev, frame_curr, frame_next: BGR images (H, W, 3).
            
        Returns:
            (u, v) centroid in the original frame coordinates, or None.
        """
        if not self.is_available:
            return None

        import torch

        orig_h, orig_w = frame_curr.shape[:2]

        # Resize and normalize
        frames = []
        for f in [frame_prev, frame_curr, frame_next]:
            resized = cv2.resize(f, (self.INPUT_W, self.INPUT_H))
            resized = resized.astype(np.float32) / 255.0
            frames.append(resized)

        # Stack into 9-channel input (H, W, 9) → (1, 9, H, W)
        stacked = np.concatenate(frames, axis=2)
        tensor = torch.from_numpy(stacked).permute(2, 0, 1).unsqueeze(0).to(self.device)

        with torch.no_grad():
            heatmap = self.model(tensor)[0, 0].cpu().numpy()

        centroid = heatmap_to_centroid(heatmap)
        if centroid is None:
            return None

        # Scale back to original resolution
        u = centroid[0] * orig_w / self.INPUT_W
        v = centroid[1] * orig_h / self.INPUT_H
        return (u, v)


# Lazy import guard for cv2 (only needed in predict())
try:
    import cv2
except ImportError:
    pass
