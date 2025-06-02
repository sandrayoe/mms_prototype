import json
import pywt
import numpy as np
import matplotlib.pyplot as plt
import os

def load_combined_signal(filepath, num_samples=300):
    with open(filepath) as f:
        data = json.load(f)
    imu1 = np.concatenate([np.array(frame["imu1"]) for frame in data])
    imu2 = np.concatenate([np.array(frame["imu2"]) for frame in data])
    return np.maximum(np.abs(imu1), np.abs(imu2))[:num_samples]

def wavelet_decompose_and_reconstruct(signal, wavelet='haar', level=3):
    coeffs = pywt.wavedec(signal, wavelet, level=level)

    def reconstruct_level(coeffs, keep_idx):
        return pywt.waverec([
            coeff if idx == keep_idx else np.zeros_like(coeff)
            for idx, coeff in enumerate(coeffs)
        ], wavelet)[:len(signal)]

    return {
        "A3": reconstruct_level(coeffs, 0),
        "D3": reconstruct_level(coeffs, 1),
        "D2": reconstruct_level(coeffs, 2),
        "D1": reconstruct_level(coeffs, 3),
    }

def compute_energy(signal):
    return np.sum(signal ** 2)

# File paths
script_dir = os.path.dirname(os.path.abspath(__file__))
file_non_pf = os.path.join(script_dir, "rawIMU_nonPF1.json")
file_pf = os.path.join(script_dir, "rawIMU_PF2.json")

# Load and decompose both signals
signal_non_pf = load_combined_signal(file_non_pf)
signal_pf = load_combined_signal(file_pf)

components_non_pf = wavelet_decompose_and_reconstruct(signal_non_pf)
components_pf = wavelet_decompose_and_reconstruct(signal_pf)

# Calculate energy difference
print("=== Energy Comparison Between PF and non-PF ===")
for key in components_non_pf:
    energy_non_pf = compute_energy(components_non_pf[key])
    energy_pf = compute_energy(components_pf[key])
    abs_diff = abs(energy_pf - energy_non_pf)
    rel_diff = abs_diff / (energy_non_pf + 1e-6)  # avoid divide-by-zero
    print(f"{key}: PF = {energy_pf:.2f}, non-PF = {energy_non_pf:.2f}, AbsDiff = {abs_diff:.2f}, RelDiff = {rel_diff:.2f}")

# Plot PF and non-PF side by side
labels = ["A3", "D3", "D2", "D1"]
plt.figure(figsize=(18, 10))

for i, key in enumerate(labels):
    plt.subplot(len(labels), 2, 2*i + 1)
    plt.plot(components_non_pf[key], label=f"{key} (non-PF)")
    plt.title(f"{key} - Non-Plantar Flexion")
    plt.legend()
    plt.grid(True)

    plt.subplot(len(labels), 2, 2*i + 2)
    plt.plot(components_pf[key], label=f"{key} (PF)", color="orange")
    plt.title(f"{key} - Plantar Flexion")
    plt.legend()
    plt.grid(True)

plt.tight_layout(pad=3.0)
plt.show()
