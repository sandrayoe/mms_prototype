import numpy as np
import matplotlib.pyplot as plt

# Define electrode pairs (36 unique pairs from 9 electrodes)
electrodes = list(range(1,10))
electrode_pairs = [(i, j) for i in electrodes for j in electrodes if i < j]
num_pairs = len(electrode_pairs)

# Simulated muscle activation function
def muscle_activation(pair, current):
    """Simulate muscle response based on electrode pair and current amplitude."""
    optimal_pair = (3, 5)  # Assume best pair is (3,5)
    distance = abs(pair[0] - optimal_pair[0]) + abs(pair[1] - optimal_pair[1])
    
    # Activation is a function of distance and current amplitude
    activation = np.exp(-0.5 * distance) * (1 - np.exp(-0.3 * current))  
    noise = np.random.normal(0, 0.05)  
    return max(activation + noise, 0)  

# Ornstein-Uhlenbeck (OU) process parameters
lambda_decay = 0.1
q_variance = 0.7
dt = 0.1  

# SES Parameters
num_iterations = 80  

# Current Amplitude Parameters
I_min = 1  
I_max = 15.0  
increment_I = 1.0  

# Initialize electrode pair selection and current
current_pair_index = np.random.randint(num_pairs)  
I_k = I_min  
eta = 0  
stability_counter = 0  
current_stable = False  

# Store history for visualization
history = []
activation_history = []
current_history = []

# Optimization loop
for iteration in range(num_iterations):
    # Apply Ornstein-Uhlenbeck process for perturbation in electrode pair selection
    eta = eta - lambda_decay * eta * dt + np.sqrt(q_variance) * np.random.normal(0, 1)
    
    # Convert perturbation into a discrete index change
    perturbed_index = int(current_pair_index + eta)  
    perturbed_index = max(0, min(num_pairs - 1, perturbed_index))  

    # Select new electrode pair
    new_pair = electrode_pairs[perturbed_index]

    # Measure muscle activation with current I_k
    new_activation = muscle_activation(new_pair, I_k)

    # Stability-based electrode selection
    if new_activation > muscle_activation(electrode_pairs[current_pair_index], I_k):
        stability_counter += 1  
        if stability_counter >= 10:
            current_pair_index = perturbed_index  
            stability_counter = 0  
    else:
        stability_counter = 0  # Reset if new pair is not consistently better


    # Adaptive Current Increase (stops when activation is strong)
    if new_activation < 0.2 and not current_stable:
        I_k = min(I_k + increment_I, I_max)  
        print(f"⚡ Increasing current to {I_k} mA (activation too low: {new_activation:.2f})")
    elif new_activation >= 0.4:
        current_stable = True  # Stop increasing current once activation is good

    # Store results for visualization
    history.append(new_pair)
    activation_history.append(new_activation)
    current_history.append(I_k)

# Convert history to an array for plotting
history_indices = [electrode_pairs.index(pair) for pair in history]

# Plot the optimization progress
plt.figure(figsize=(10, 5))
plt.subplot(2, 1, 1)
plt.plot(activation_history, label="Muscle Activation")
plt.xlabel("Iterations")
plt.ylabel("Activation Level")
plt.title("SES Optimization with Stability & Convergence Check")
plt.legend()

plt.subplot(2, 1, 2)
plt.plot(current_history, label="Current Amplitude (mA)", color='orange')
plt.xlabel("Iterations")
plt.ylabel("Current (mA)")
plt.legend()

plt.tight_layout()
plt.show()

# Print final best electrode pair and current
best_pair = electrode_pairs[current_pair_index]
print(f"✅ Best Electrode Pair Found: {best_pair}, Final Current: {I_k:.2f} mA")