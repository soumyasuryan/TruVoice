import io
import logging
from typing import Tuple, Union
import librosa
import numpy as np
import torch

logger = logging.getLogger(__name__)

TARGET_SAMPLE_RATE = 16000


def preprocess_audio_waveform(
    audio_input: Union[str, bytes, np.ndarray, torch.Tensor],
    sample_rate: int = TARGET_SAMPLE_RATE,
    target_sample_rate: int = TARGET_SAMPLE_RATE,
) -> Tuple[torch.Tensor, float]:
    """
    Preprocesses audio from various input types (file path, raw bytes, numpy array, or torch tensor)
    into a standardized float32 tensor of shape (1, num_samples) at target_sample_rate (16,000 Hz).

    Returns:
        (waveform_tensor, rms_energy)
    """
    waveform_np: np.ndarray | None = None

    if isinstance(audio_input, str):
        # Audio file path
        waveform_np, sr = librosa.load(audio_input, sr=target_sample_rate, mono=True)
    elif isinstance(audio_input, bytes):
        # Raw audio byte buffer
        buffer = io.BytesIO(audio_input)
        waveform_np, sr = librosa.load(buffer, sr=target_sample_rate, mono=True)
    elif isinstance(audio_input, torch.Tensor):
        tensor = audio_input.detach().cpu().float()
        if tensor.ndim > 1:
            tensor = tensor.mean(dim=0)  # Convert multi-channel to mono
        waveform_np = tensor.numpy()
        sr = sample_rate
    elif isinstance(audio_input, np.ndarray):
        waveform_np = audio_input.astype(np.float32)
        if waveform_np.ndim > 1:
            waveform_np = np.mean(waveform_np, axis=0)  # Convert stereo/multi-channel to mono
        sr = sample_rate
    else:
        raise ValueError(f"Unsupported audio input type: {type(audio_input)}")

    # Ensure float32 dtype and normalized range
    if waveform_np.dtype != np.float32:
        waveform_np = waveform_np.astype(np.float32)

    # Resample if sample rate does not match target
    if sr != target_sample_rate and len(waveform_np) > 0:
        waveform_np = librosa.resample(y=waveform_np, orig_sr=sr, target_sr=target_sample_rate)

    # Compute raw RMS energy before normalization
    rms_energy = float(np.sqrt(np.mean(waveform_np**2))) if len(waveform_np) > 0 else 0.0

    # Normalize integer PCM / high-amplitude waveforms
    max_val = np.max(np.abs(waveform_np)) if len(waveform_np) > 0 else 0.0
    if max_val > 1.0:
        waveform_np = waveform_np / max_val

    # Ensure waveform has minimum length (at least 1,600 samples ~ 0.1s)
    if len(waveform_np) == 0:
        waveform_np = np.zeros(1600, dtype=np.float32)

    waveform_tensor = torch.from_numpy(waveform_np).float().unsqueeze(0)  # Shape (1, num_samples)
    return waveform_tensor, rms_energy
