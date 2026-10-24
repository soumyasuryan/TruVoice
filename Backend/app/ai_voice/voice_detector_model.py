import torch
import torch.nn as nn
from transformers import Wav2Vec2Config, Wav2Vec2Model


class DeepfakeAudioClassifier(nn.Module):
    """
    Neural Deepfake Voice Detection Model Architecture:
    Pretrained Wav2Vec2 acoustic feature representation backbone (768 hidden dim)
    combined with a sequential classification head for binary spoof classification (Human vs AI).
    """

    def __init__(self, num_classes: int = 2, dropout_p: float = 0.3):
        super().__init__()
        config = Wav2Vec2Config()
        self.wav2vec2 = Wav2Vec2Model(config)
        self.classifier = nn.Sequential(
            nn.Linear(768, 256),
            nn.BatchNorm1d(256),
            nn.ReLU(),
            nn.Dropout(dropout_p),
            nn.Linear(256, num_classes),
        )

    def forward(self, input_values: torch.Tensor) -> torch.Tensor:
        """
        Forward pass:
        Args:
            input_values: Waveform tensor of shape (batch_size, num_samples) at 16,000 Hz.
        Returns:
            logits: Unnormalized logits tensor of shape (batch_size, num_classes).
        """
        outputs = self.wav2vec2(input_values)
        hidden_states = outputs.last_hidden_state  # Shape: (batch_size, time_steps, 768)
        # Mean temporal pooling across time dimension
        pooled = torch.mean(hidden_states, dim=1)  # Shape: (batch_size, 768)
        logits = self.classifier(pooled)           # Shape: (batch_size, num_classes)
        return logits
