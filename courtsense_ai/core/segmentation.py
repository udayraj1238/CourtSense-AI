"""
segmentation.py

Handles SegFormer model loading and inference for masking the court, lines, and players.
We use HuggingFace transformers and a pre-trained SegFormer model.
"""

import numpy as np
from PIL import Image
import torch
from transformers import SegformerImageProcessor, SegformerForSemanticSegmentation
from typing import Dict


class CourtSegmenter:
    def __init__(self, model_id: str = "nvidia/segformer-b2-finetuned-cityscapes-1024-1024"):
        """
        Initializes the SegFormer model and processor for semantic segmentation.
        Uses a Cityscapes-finetuned model as a placeholder/baseline. A proper
        tennis-court-finetuned model would be ideal in production.
        
        Args:
            model_id (str): HuggingFace model hub ID.
        """
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        print(f"Loading SegFormer '{model_id}' on {self.device}...")
        
        self.processor = SegformerImageProcessor.from_pretrained(model_id)
        self.model = SegformerForSemanticSegmentation.from_pretrained(model_id).to(self.device)
        self.model.eval()

    def segment_frame(self, frame: np.ndarray) -> Dict[str, np.ndarray]:
        """
        Runs SegFormer inference on an input frame and returns masks.
        
        Args:
            frame (np.ndarray): Input video frame (RGB, HxWxC, uint8).
            
        Returns:
            Dict[str, np.ndarray]: Dictionary mapping class names to binary masks (HxW).
        """
        # Convert OpenCV/numpy array to PIL Image
        pil_image = Image.fromarray(frame)
        
        # Prepare inputs
        inputs = self.processor(images=pil_image, return_tensors="pt").to(self.device)
        
        # Forward pass
        with torch.no_grad():
            outputs = self.model(**inputs)
            
        # Post-process logits to masks
        logits = outputs.logits  # shape: (1, num_classes, H/4, W/4)
        
        # Resize logits to original image size
        logits = torch.nn.functional.interpolate(
            logits, size=pil_image.size[::-1], mode="bilinear", align_corners=False
        )
        
        # Get segmentation mask (argmax over class dimension)
        seg_mask = logits.argmax(dim=1)[0].cpu().numpy()
        
        # NOTE: A real CourtSense model needs specific classes (Court, Lines, Net, Players).
        # Since we use cityscapes placeholder, we mock the extraction logic here:
        # e.g., Road -> Court (approx), Person -> Player.
        
        masks = {
            "Segmentation": seg_mask,
            "Players": (seg_mask == 11).astype(np.uint8) * 255,   # Class 11 is 'person' in Cityscapes
            "CourtApprox": (seg_mask == 0).astype(np.uint8) * 255 # Class 0 is 'road' in Cityscapes
        }
        
        return masks
