from flask import Flask, request, jsonify
from flask_cors import CORS
import subprocess
import psutil
import json
import os 

app = Flask(__name__)
CORS(app) 

@app.route("/save-electrode-stats", methods=["POST"])
def save_electrode_stats():
    data = request.get_json()
    print("Current working directory:", os.getcwd())
    try:
        with open('electrodeStats.json', 'w') as f:
            json.dump(data, f, indent=2)
        return jsonify({"message": "Electrode stats saved successfully."}), 200
    except Exception as e:
        return jsonify({"error": f"Failed to save data: {str(e)}"}), 500
    
@app.route("/kill-server", methods=["POST"])
def kill_server():
    """Terminate the React app running on port 3000."""
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
