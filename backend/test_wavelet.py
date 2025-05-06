import json
import pywt
import numpy as np
import matplotlib.pyplot as plt

import os
#print("Current working directory:", os.getcwd())

#1,12,14,15,18, 48,49 
script_dir = os.path.dirname(os.path.abspath(__file__))
file_path = os.path.join(script_dir, "rawIMU_PFMovt2.json")

with open(file_path) as f:
    data = json.load(f)

for i, frame in enumerate(data):
    imu1 = np.array(frame["imu1"])
    imu2 = np.array(frame["imu2"])

imu1 = np.concatenate([np.array(frame["imu1"]) for frame in data])
imu2 = np.concatenate([np.array(frame["imu2"]) for frame in data])
combined_signal = np.maximum(np.abs(imu1), np.abs(imu2))

wavelet = 'haar'
level = 3
coeffs = pywt.wavedec(combined_signal, wavelet, level=level)

# Function to reconstruct a specific level
def reconstruct_level(coeffs, keep_idx):
    return pywt.waverec([
        coeff if idx == keep_idx else np.zeros_like(coeff)
        for idx, coeff in enumerate(coeffs)
    ], wavelet)[:len(combined_signal)]

# Reconstruct individual components
A3 = reconstruct_level(coeffs, 0)
D3 = reconstruct_level(coeffs, 1)
D2 = reconstruct_level(coeffs, 2)
D1 = reconstruct_level(coeffs, 3)

envelope_add = np.abs(D3 + D2)

# Plot everything
labels = [
    ("A3 (Approximation / Low Freq)", A3),
    ("D3 (Lower-Mid Freq)", D3),
    ("D2 (Mid-High Freq)", D2),
    ("D1 (High Freq)", D1),
    ("|D3 + D2| (Envelope Add)", envelope_add)
]


plt.figure(figsize=(18, 18))

for i, (label, signal) in enumerate(labels):
    plt.subplot(len(labels), 1, i + 1)
    plt.plot(signal, label=label)
    plt.title(f"Combined IMU - {label}")
    plt.legend()
    plt.grid(True)

plt.tight_layout(pad=3.0)
plt.show()