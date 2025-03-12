from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import numpy as np
import subprocess
import threading
import psutil
from ses_module import muscle_activation, electrode_pairs

app = Flask(__name__)
CORS(app)  # Enable CORS to allow frontend requests

# Store the current best pair and current level
data_store = {
    "best_pair": (1, 2),
    "current_intensity": 1.0,
}

# Background SES Optimization Function
def run_optimization():
    """Function to run SES simulation in a separate thread."""
    try:
        current_intensity = data_store["current_intensity"]
        prev_pair = data_store["best_pair"]

        # Simulate optimization step
        new_index = np.random.randint(len(electrode_pairs))
        new_pair = electrode_pairs[new_index]
        new_activation = muscle_activation(new_pair, current_intensity)

        # Update stored values if activation improves
        if new_activation > muscle_activation(prev_pair, current_intensity):
            data_store["best_pair"] = new_pair
            data_store["current_intensity"] = min(current_intensity + 1, 15.0)

        print(f"Optimizing... Best pair: {data_store['best_pair']} | Current: {data_store['current_intensity']} mA")

    except Exception as e:
        print(f"Optimization error: {e}")
        

@app.route("/optimize", methods=["POST"])
def optimize():
    """Starts SES optimization once per request."""
    optimization_thread = threading.Thread(target=run_optimization, daemon=True)
    optimization_thread.start()

    return jsonify({"message": "Optimization started."})

@app.route("/kill-server", methods=["POST"])
def kill_server():
    print("Received request to kill React app on port 3000.")

    try:
        # Find the process running on port 3000
        result = subprocess.run(
            "netstat -ano | findstr :3000", shell=True, capture_output=True, text=True
        )
        output = result.stdout.strip()

        if not output:
            print("No process found on port 3000.")
            return jsonify({"error": "No React process found on port 3000."}), 404

        # Extract PID from netstat output
        pid = output.split()[-1]
        print(f"Killing React process {pid}")

        # Kill the process using psutil (more reliable than taskkill)
        for proc in psutil.process_iter(attrs=["pid", "name", "cmdline"]):
            if str(proc.info["pid"]) == pid or ("node" in proc.info["name"].lower() and "react-scripts" in " ".join(proc.info["cmdline"]).lower()):
                print(f"Force killing npm process: {proc.info['pid']} - {proc.info['name']}")
                proc.terminate()  # Sends SIGTERM to gracefully stop the process
                proc.wait(timeout=5)  # Wait up to 5 seconds for process to exit
                print(f"✅ Process {proc.info['pid']} stopped successfully.")

        print("Port 3000 killed successfully.")

    except Exception as e:
        print(f"Error killing port 3000: {e}")
        return jsonify({"error": "Failed to kill React app on port 3000."}), 500

    return jsonify({"message": "React app on port 3000 terminated."})

if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)

