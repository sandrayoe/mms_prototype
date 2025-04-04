import React, { createContext, useState, useContext, useRef, useEffect } from "react";

// Define the Bluetooth context and its type
interface BluetoothContextType {
    connect: () => Promise<void>;
    disconnect: () => Promise<void>;
    isConnected: boolean;
    sendCommand: (...args: string[]) => void;
    stopStimulation: () => Promise<void>;
    runOptimizationLoop: (
      updateCurrentPair: (pair: [number, number]) => void,
      updateBestPair: (pair: [number, number]) => void,
      updateCurrentValue: (current: number) => void,
      updateBestCurrent: (current: number) => void, 
      minCurrent: number, 
      maxCurrent: number
    ) => Promise<void>;
    stopOptimizationLoop: () => Promise<void>;
    imuData: { imu1_changes: number[]; imu2_changes: number[] };
    startIMU: () => void;
    stopIMU: () => void;
    isOptimizationRunning: boolean; 
    initializeDevice: () => void; 
}

// Create the context
export const BluetoothContext = createContext<BluetoothContextType | undefined>(undefined);

export const BluetoothProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isConnected, setIsConnected] = useState(false);
  const [device, setDevice] = useState<BluetoothDevice | null>(null);
  const [rxCharacteristic, setRxCharacteristic] = useState<BluetoothRemoteGATTCharacteristic | null>(null);
  const [txCharacteristic, setTxCharacteristic] = useState<BluetoothRemoteGATTCharacteristic | null>(null);

  const deviceRef = useRef<BluetoothDevice | null>(null);
  const isManualDisconnectRef = useRef(false);

  const isInitializingRef = useRef<boolean>(false);

  const isOptimizationRunningRef = useRef(false); 
  const [isOptimizationRunning, setIsOptimizationRunning] = useState(false);

  const [imuData, setImuData] = useState<{ imu1_changes: number[]; imu2_changes: number[] }>({
    imu1_changes: [],
    imu2_changes: []
  });
  const imuDataRef = useRef(imuData);
  useEffect(() => {
    imuDataRef.current = imuData;
  }, [imuData]);

  // Bluetooth service & characteristic UUIDs
  const SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e"; // Nordic UART Service
  const RX_CHARACTERISTIC_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e"; // Write characteristic (Send)
  const TX_CHARACTERISTIC_UUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"; // Notify characteristic (Receive)

  const connect = async (): Promise<void> => {
    try {
      const selectedDevice = await navigator.bluetooth.requestDevice({
        filters: [{ name: "MMS nus" }],
        optionalServices: [SERVICE_UUID]
      });

      if (deviceRef.current) {
        deviceRef.current.removeEventListener("gattserverdisconnected", handleDisconnection);
      }

      const server = await selectedDevice.gatt?.connect();
      const service = await server?.getPrimaryService(SERVICE_UUID);
      const rxChar = await service?.getCharacteristic(RX_CHARACTERISTIC_UUID);
      const txChar = await service?.getCharacteristic(TX_CHARACTERISTIC_UUID);

      if (!rxChar) {
        console.error("❌ RX characteristic not found! Check UUID.");
      } else {
          console.log("✅ RX Characteristic Found.");
      }

      if (!txChar) {
          console.error("❌ TX characteristic not found! Check UUID.");
      } else {
          console.log("✅ TX Characteristic Found. Starting notifications...");
          await txChar.startNotifications();
          txChar.addEventListener("characteristicvaluechanged", handleIncomingData);
      }

      setRxCharacteristic(rxChar || null);
      setTxCharacteristic(txChar || null);
      setDevice(selectedDevice);
      deviceRef.current = selectedDevice;
      setIsConnected(true);

      console.log("✅ Connected to:", selectedDevice.name);
      selectedDevice.addEventListener("gattserverdisconnected", handleDisconnection);
    } catch (error) {
      console.error("❌ Bluetooth connection failed:", error);
    }
  };

  const disconnect = async (): Promise<void> => {
    if (deviceRef.current) {
      isManualDisconnectRef.current = true;
      deviceRef.current.removeEventListener("gattserverdisconnected", handleDisconnection);

      if (deviceRef.current.gatt?.connected) {
        deviceRef.current.gatt.disconnect();
        console.log("🔌 Device disconnected manually");
      }

      setIsConnected(false);
      setDevice(null);
      isManualDisconnectRef.current = false;
    }
  };

  // Handle unexpected disconnection
  const handleDisconnection = () => {
    if (isManualDisconnectRef.current) return;
    console.log("⚠️ Device disconnected unexpectedly");
    setIsConnected(false);
    setDevice(null);
  };
  
  const IDLE_VALUE = 2048;  // idle value for IMU
  let pendingResolve: ((data: string) => void) | null = null;

  const handleCommandResponse = (message: string) => {
    console.log("📩 Command response received:", message);
    if (pendingResolve) {
        let resolver = pendingResolve;
        pendingResolve = null; 
        resolver(message);
    }
  };

  const maxHistory = 500; // max history for the IMU data

  const handleIMUData = (rawBytes: Uint8Array) => {

    try {
      const dataView = new DataView(rawBytes.buffer);
      const sensor1Changes: number[] = [];
      const sensor2Changes: number[] = [];

      for (let i = 0; i < rawBytes.length; i += 4) {
          const sensor1Value = dataView.getUint16(i, true);
          const sensor2Value = dataView.getUint16(i + 2, true);

          // Calculate change (delta) from idle value
          const sensor1Delta = Math.abs(sensor1Value - IDLE_VALUE);
          const sensor2Delta = Math.abs(sensor2Value - IDLE_VALUE);

          sensor1Changes.push(sensor1Delta);
          sensor2Changes.push(sensor2Delta);
    }
    // Update IMU state separately
    setImuData(prev => ({
      imu1_changes: [...prev.imu1_changes, ...sensor1Changes].slice(-maxHistory),
      imu2_changes: [...prev.imu2_changes, ...sensor2Changes].slice(-maxHistory)
    }));

    } catch (error) {
      console.error("❌ Error processing IMU data:", error);
    }
      
  };

  const handleIncomingData = (event: any) => {
    const target = event.target as BluetoothRemoteGATTCharacteristic;
    if (!target || !target.value) {
        console.warn("⚠️ Received event without a valid value.");
        return;
    }
    const value = target.value;
    const rawBytes = new Uint8Array(value.buffer);
    //console.log("📩 Incoming BLE data:", new TextDecoder().decode(event.target.value.buffer));

    if (isInitializingRef.current) {
      let message = new TextDecoder().decode(rawBytes);
      handleCommandResponse(message);
      return; 
    } 

    handleIMUData(rawBytes);
  };


  // Start IMU data streaming
  const startIMU = async () => {
      console.log("IMU Started");

      if (!txCharacteristic) {
          console.error("❌ TX characteristic not found!");
          return;
      }

      try {
          await sendCommand("b"); // Start IMU data streaming from the device
          txCharacteristic.addEventListener("characteristicvaluechanged", handleIncomingData);
          await txCharacteristic.startNotifications();
          console.log("✅ Listening for IMU data...");
      } catch (error) {
          console.error("❌ Failed to start IMU:", error);
      }
  };

  // Stop IMU data streaming
  const stopIMU = async () => {
      console.log("IMU Stopped");

      if (!txCharacteristic) return;

      try {
          await sendCommand("B"); // Stop IMU data streaming from the device
          txCharacteristic.removeEventListener("characteristicvaluechanged", handleIncomingData);
          await txCharacteristic.stopNotifications();
      } catch (error) {
          console.error("❌ Failed to stop IMU:", error);
      }
  };

  const sendCommand = async (...args: (string | number)[]) => {
    if (!rxCharacteristic) {
        console.error("❌ RX characteristic not found!");
        return;
    }

    const commandBytes = new Uint8Array(
        args.flatMap(arg =>
            typeof arg === "number"
                ? [arg & 0xFF] // Send number as a raw byte
                : typeof arg === "string"
                ? arg.split("").map(char => char.charCodeAt(0)) // Convert string to ASCII
                : []
        )
    );
    //console.log(`📤 Sending Command as Raw Bytes:`, commandBytes);
    await rxCharacteristic.writeValue(commandBytes);
};


  const stopStimulation = async () => {
    await sendCommand("e", "0", "0", "0", "0", "0"); //command to stop the stimulation in CU
  };

  // extra function for the response if there are some parameters' changes in CU
  function waitForDeviceResponse(expectedCmd: string, delay: number = 1000): Promise<string> {
    return new Promise((resolve) => {
        const expected = expectedCmd.trim().toLowerCase();
        let resolved = false;

        const timeoutId = setTimeout(() => {
            if (!resolved) {
                resolve("No response received");
            }
        }, delay);

        const handleResponse = (response: string) => {
            if (!resolved) {
                clearTimeout(timeoutId);
                const resp = response.trim().toLowerCase();
                resolved = true;
                resolve(resp.startsWith(expected) ? response : `Unexpected response: ${response}`);
            }
        };

        //pendingResolve = handleResponse; // Store the function for use when response arrives
    });
  }

  const initializationConfig = [
    { cmd: "f", value: 35 },  // frequency
    { cmd: "d", value: 7 }, // phase duration
    { cmd: "o", value: 5 },   // ON time
    { cmd: "O", value: 10 },   // OFF time
    { cmd: "r", value: 0 },  // ramp-up time
    { cmd: "R", value: 0 }    // ramp-down time
  ];

  // Initialize device parameters (that need to be set)
  const initializeDevice = async() =>{

    if (!txCharacteristic) {
      console.error("❌ TX characteristic not found!");
      return;
    }

    try {
        isInitializingRef.current = true;
        console.log("Initializing device parameters...");
        const padValue = (num: number): string => num < 10 ? "0" + num : num.toString();
    
        for (const { cmd, value } of initializationConfig) {
          console.log(`Sending command '${cmd}'`);
          const responsePromise = waitForDeviceResponse(cmd, 1000);
          await sendCommand(cmd, padValue(value), "0");
          await responsePromise;
        }
    
        await sendCommand("s");
        isInitializingRef.current = false;
        await new Promise((res) => setTimeout(res, 500));

    } catch (error) {
        console.error("❌ Failed to initialize:", error);
    }
  }

  //Helper for Washout Filter
  function applyWashoutFilterToWindow(
      samples: number[],
      initialFiltered: number,
      h: number,
      dt: number,
      zeta: number
    ): number[] {
      let filteredValues: number[] = [];
      let currentFiltered = initialFiltered;
      for (let sample of samples) {
        currentFiltered = (1 - Math.exp(-h * dt)) * (sample - zeta) + Math.exp(-h * dt) * currentFiltered;
        filteredValues.push(currentFiltered);
      }
      return filteredValues;
    }

    // --- Bandpass Filter Functions ---

    /**
     * First-order high-pass filter using the difference equation:
     * y[n] = alpha * (y[n-1] + x[n] - x[n-1])
     * @param samples Array of sample values.
     * @param cutoff Cutoff frequency.
     * @param dt Sampling time interval.
     * @returns Array of filtered sample values.
     */
    function applyHighPassFilter(samples: number[], cutoff: number, dt: number): number[] {
      const RC: number = 1 / (2 * Math.PI * cutoff);
      const alpha: number = RC / (RC + dt);
      const filtered: number[] = [];
      let previousFiltered: number = samples[0];
      let previousSample: number = samples[0];
      
      for (let i = 0; i < samples.length; i++) {
        const currentFiltered: number = alpha * (previousFiltered + samples[i] - previousSample);
        filtered.push(currentFiltered);
        previousFiltered = currentFiltered;
        previousSample = samples[i];
      }
      return filtered;
    }

    /**
     * First-order low-pass filter using the difference equation:
     * y[n] = y[n-1] + alpha * (x[n] - y[n-1])
     * @param samples Array of sample values.
     * @param cutoff Cutoff frequency.
     * @param dt Sampling time interval.
     * @returns Array of filtered sample values.
     */
    function applyLowPassFilter(samples: number[], cutoff: number, dt: number): number[] {
      const RC: number = 1 / (2 * Math.PI * cutoff);
      const alpha: number = dt / (RC + dt);
      const filtered: number[] = [];
      let previousFiltered: number = samples[0];
      
      for (const sample of samples) {
        const currentFiltered: number = previousFiltered + alpha * (sample - previousFiltered);
        filtered.push(currentFiltered);
        previousFiltered = currentFiltered;
      }
      return filtered;
    }

    /**
     * Bandpass filter by cascading the high-pass and low-pass filters.
     * 'lowCut' removes frequencies below the desired band,
     * 'highCut' removes frequencies above the desired band.
     * @param samples Array of sample values.
     * @param lowCut Low cutoff frequency.
     * @param highCut High cutoff frequency.
     * @param dt Sampling time interval.
     * @returns Array of bandpass filtered sample values.
     */
    function applyBandpassFilterToWindow(samples: number[], lowCut: number, highCut: number, dt: number): number[] {
      const highPassed: number[] = applyHighPassFilter(samples, lowCut, dt);
      const bandPassed: number[] = applyLowPassFilter(highPassed, highCut, dt);
      return bandPassed;
    }

    // Helper function to calculate SNR (in dB) from an array of numbers
    const calculateSNR = (signal: number[]): number => {
      const signalPower = signal.reduce((sum, val) => sum + val * val, 0) / signal.length;
      const mean = signal.reduce((sum, val) => sum + val, 0) / signal.length;
      const noisePower = signal.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / signal.length;
      if (noisePower === 0) return 0;
      return 10 * Math.log10(signalPower / noisePower);
    };

    const calculateSNROfDerivative = (signal: number[]): number => {
      // If there's not enough data to compute a derivative, return 0
      if (signal.length < 2) return 0;
    
      // Compute the first derivative of the signal
      const derivative: number[] = [];
      for (let i = 1; i < signal.length; i++) {
        derivative.push(signal[i] - signal[i - 1]);
      }
    
      // Calculate the signal power of the derivative
      const signalPower = derivative.reduce((sum, val) => sum + val * val, 0) / derivative.length;
      
      // Calculate the mean of the derivative
      const mean = derivative.reduce((sum, val) => sum + val, 0) / derivative.length;
      
      // Calculate the noise power as the variance of the derivative
      const noisePower = derivative.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / derivative.length;
      
      // Handle the case when noisePower is 0
      if (noisePower === 0) return 0;
      
      return 10 * Math.log10(signalPower / noisePower);
    };
    

    // Helper function to create a combined electrode stats tracker
    interface ElectrodeStats {
      usage: number;
      aggregatedScore: number;
      scores: number[];
      averageScore: number; 
    }
    
    const createElectrodeStatsTracker = (numElectrodes: number): Record<number, ElectrodeStats> => {
      const tracker: Record<number, ElectrodeStats> = {};
      for (let i = 1; i <= numElectrodes; i++) {
        tracker[i] = {
          usage: 0,
          aggregatedScore: 0,
          scores: [],
          averageScore: 0,
        };
      }
      return tracker;
    };
    
    const updateElectrodeStats = (
      tracker: Record<number, ElectrodeStats>,
      pair: [number, number],
      pairScore: number
    ): void => {
      pair.forEach(electrode => {
        tracker[electrode].usage++;
        tracker[electrode].aggregatedScore += pairScore;
        tracker[electrode].scores.push(pairScore);
        // Update the average score; avoid division by zero
        tracker[electrode].averageScore = tracker[electrode].usage > 0 
          ? tracker[electrode].aggregatedScore / tracker[electrode].usage 
          : 0;
      });
    };

  const runOptimizationLoop = async (
    updateCurrentPair: (pair: [number, number]) => void,
    updateBestPair: (pair: [number, number]) => void,
    updateCurrentValue: (current: number) => void,
    updateBestCurrent: (current: number) => void,
    minCurrent: number,
    maxCurrent: number
  ) => {
      console.log("Starting SES Optimization...");
      setIsOptimizationRunning(true);
      isOptimizationRunningRef.current = true;
      await startIMU();
      await new Promise(res => setTimeout(res, 500)); // Delay to allow IMU data to populate
  
      // Generate unique pairs of electrodes (9 electrodes → 36 pairs)
      const electrodePairs: [number, number][] = [];
      const numElectrodes = 9; 

      for (let i = 1; i <= numElectrodes; i++) {
          for (let j = i + 1; j <= numElectrodes; j++) {
              electrodePairs.push([i, j]);
          }
      }
      const numPairs = electrodePairs.length;

      const statsTracker = createElectrodeStatsTracker(numElectrodes);
  
      // === SES PARAMETERS ===
      const lambdaDecay = 0.3;
      const qVariance = 0.8;
      const dt = 0.01;
      const numIterations = 120; //Max Iterations
      const h = 0.6;  // Washout filter parameter
      const alpha = 0.1; // EMA smoothing factor

      let y_filtered = 0;  // Initialize washout filter
      let eta_ema = 0;  // Initialize EMA for perturbation
      let zeta = 0;  // Assume baseline IMU response is zero

      const learningRate = 0.7;

      // Constant for the random perturbation magnitude.
      // The subtraction biases the random perturbation downward (toward lower currents).
      const currentNoiseMagnitude = 0.7; // Adjust as needed

      // Parameters to track zero pairScore occurrences
      let zeroScoreCounter = 0;
      const zeroScoreThreshold = 5; // If pairScore is 0 for 5 consecutive trials
  
      // === INITIALIZATION ===
      let currentPairIndex = Math.floor(Math.random() * numPairs);
      let I_k = minCurrent;
      let eta = 0;

      let bestPair: [number, number] = electrodePairs[currentPairIndex];

  
      console.log(`🎯 Starting with Pair: ${electrodePairs[currentPairIndex]}, Current: ${I_k}mA`);
  
      for (let iteration = 0; iteration < numIterations && isOptimizationRunningRef.current; iteration++) {
          // === Stochastic Perturbation and EMA for Smoothing ===
          eta = eta - lambdaDecay * eta * dt + Math.sqrt(qVariance) * (Math.random() - 0.5);
          eta_ema = alpha * eta + (1 - alpha) * eta_ema;

          // Perturb electrode pair index
          let eta_noise = Math.sqrt(qVariance) * (Math.random() - 0.5);
          let perturbedIndex = Math.floor(Math.max(0, Math.min(numPairs - 1, currentPairIndex + eta_noise * numPairs)));
          currentPairIndex = perturbedIndex;
          let newPair = electrodePairs[currentPairIndex];

          // ✅ Immediately send the new pair to BLE
          console.log(`⚡ Sending New Pair to BLE: (${newPair[0]}, ${newPair[1]}) at ${I_k}mA`);
          await sendCommand("e", I_k, newPair[0], newPair[1], 1, 0);
          updateCurrentPair(newPair); 

          // === Measure muscle activation using IMU ===
          const windowSize = 20;
          let recentIMU1 = imuDataRef.current.imu1_changes.slice(-windowSize);
          let recentIMU2 = imuDataRef.current.imu2_changes.slice(-windowSize);

          //console.log("IMU1 raw:", recentIMU1);
          //console.log("IMU2 raw:", recentIMU2);
          
          let filteredIMU1 = applyBandpassFilterToWindow(recentIMU1, 0.1, 2.0, dt);
          let filteredIMU2 = applyBandpassFilterToWindow(recentIMU2, 0.1, 2.0, dt);
          
          //let avgFilteredIMU1 = filteredIMU1.length ? filteredIMU1.reduce((sum, val) => sum + val, 0) / filteredIMU1.length : 0;
          //let avgFilteredIMU2 = filteredIMU2.length ? filteredIMU2.reduce((sum, val) => sum + val, 0) / filteredIMU2.length : 0;
          const snrIMU1 = calculateSNR(filteredIMU1);
          const snrIMU2 = calculateSNR(filteredIMU2);
          console.log("IMU1 SNR:", snrIMU1);
          console.log("IMU2 SNR:", snrIMU2);

          let newActivation = Math.max(Math.abs(snrIMU1), Math.abs(snrIMU2));

          // Normalize the activation based on the current level (I_k)
          // Ensure I_k is > 0 
          const normalizedActivation = I_k > 0 ? newActivation / I_k : newActivation;

          // === Washout Filter (High-Pass Filter) ===
          //y_filtered = (1 - Math.exp(-h * dt)) * (normalizedActivation - zeta) + Math.exp(-h * dt) * y_filtered;
  
           // === Compute the Gradient Estimate and Combined Score ===
          //let gradientEstimate = eta_ema * y_filtered;

          // === Update Current Using Gradient Estimate and Random Perturbation with Bias ===
          // Generate a random perturbation that is biased downward:
          const randomPerturbation = (Math.random() - 0.75) * currentNoiseMagnitude;
          //I_k = I_k + learningRate * gradientEstimate + randomPerturbation;
          I_k = I_k + randomPerturbation;
          I_k = Math.round(Math.min(maxCurrent, Math.max(minCurrent, I_k))); // Clamp and round current
          updateCurrentValue(I_k);

          // Combined score: activation performance + weighted gradient
          //let pairScore = newActivation 
          let pairScore = newActivation;
          updateElectrodeStats(statsTracker, newPair, pairScore);
          console.log(statsTracker);

           // --- Handling Zero pairScore ---
            if (pairScore <= 0.3) {
              zeroScoreCounter++;
              // If we get too many consecutive <0.3 scores, force an increment in current
              if (zeroScoreCounter >= zeroScoreThreshold) {
                I_k = Math.round(Math.min(maxCurrent, Math.max(minCurrent, I_k + 1)));
                updateCurrentValue(I_k);
                console.log(`⚡ Incrementing current: ${I_k}mA`);
                zeroScoreCounter = 0; // Reset counter after forcing an increment
              }
              // Do not update bestScore or stabilityCounter when pairScore is 0
            } else {
              // Reset zeroScore counter if we get a non-zero pairScore
              zeroScoreCounter = 0;
            }

            // === New stopping condition: check if every electrode has been used at least 4 times ===
            const allElectrodesTriedMinimumTimes = Object.values(statsTracker).every(
              (stat) => stat.usage >= 5
            );
            
            if (allElectrodesTriedMinimumTimes) {
              // Sort electrodes by average score in descending order.
              const sortedElectrodes = Object.entries(statsTracker)
                .map(([electrode, stats]) => ({
                  electrode: Number(electrode),
                  averageScore: stats.averageScore,
                }))
                .sort((a, b) => b.averageScore - a.averageScore);
            
              // Check that there are at least two electrodes to form a pair.
              if (sortedElectrodes.length >= 2) {
                bestPair = [sortedElectrodes[0].electrode, sortedElectrodes[1].electrode];
                console.log(
                  `✅ All electrodes have been tried at least 4 times. Best electrode pair: ${bestPair[0]} and ${bestPair[1]}, with average scores of ${sortedElectrodes[0].averageScore.toFixed(3)} and ${sortedElectrodes[1].averageScore.toFixed(3)}, respectively.`
                );
              } else {
                console.log('Not enough electrodes to form a pair.');
              }

              await stopOptimizationLoop();
              updateBestPair(bestPair); 
              updateBestCurrent(I_k);

              console.log("Sending electrode stats to backend...", statsTracker);
              // Send the electrode stats data to the backend
              try {
                const response = await fetch('http://localhost:5000/save-electrode-stats', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify(statsTracker)
                });
                const data = await response.json();
                console.log(data.message);
              } catch (error) {
                console.error('Error sending electrode stats:', error);
              }

              return;
            }

          // === Stopping Conditions ===
          if (I_k - 1 >= maxCurrent) {
            console.log(`⚡ Maximum current reached (${maxCurrent}mA). Stopping optimization.`);
            await stopOptimizationLoop();
            updateBestPair(bestPair);
            updateBestCurrent(I_k);
            return;
          }

          await new Promise(res => setTimeout(res, 700)); // delay 700ms before the next iteration
      }
      console.log(`Optimization Complete. Best Pair: ${electrodePairs[currentPairIndex]}, Final Current: ${I_k}mA`);
      await stopOptimizationLoop();
      updateBestPair(bestPair);
      updateBestCurrent(I_k); 
  };  
  
    const stopOptimizationLoop = async () => {
        isOptimizationRunningRef.current = false; 
        setIsOptimizationRunning(false);
        await stopStimulation();
    }; 

  return (
    <BluetoothContext.Provider value={{
      connect,
      disconnect,
      isConnected,
      sendCommand,
      stopStimulation,
      runOptimizationLoop,
      stopOptimizationLoop,
      imuData,
      startIMU,
      stopIMU,
      isOptimizationRunning, 
      initializeDevice 
    }}>
      {children}
    </BluetoothContext.Provider>
  );
};

export const useBluetooth = () => {
  const context = useContext(BluetoothContext);
  if (!context) {
    throw new Error("useBluetooth must be used within a BluetoothProvider");
  }
  return context;
};