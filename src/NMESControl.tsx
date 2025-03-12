import React, { useState, useEffect } from "react";
import { useBluetooth } from "./BluetoothContext";
import BluetoothControl from "./BluetoothControl";
import styles from "./NMESControlPanel.module.css";
import { LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend } from "recharts";

const NMESControlPanel: React.FC = () => {
  const { isConnected } = useBluetooth();
  const [sensor1Data, setSensor1Data] = useState([{ time: Date.now(), sensorValue: 0 }]);
  const [sensor2Data, setSensor2Data] = useState([{ time: Date.now(), sensorValue: 0 }]);
  const [minCurrent, setMinCurrent] = useState(1);
  const [maxCurrent, setMaxCurrent] = useState(15);
  const [isRunning, setIsRunning] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);



  useEffect(() => {
    if (isConnected) {
      const interval = setInterval(() => {
        const time = Date.now();
        setSensor1Data((prevData) => [...prevData.slice(-49), { time, sensorValue: Math.random() * 100 }]);
        setSensor2Data((prevData) => [...prevData.slice(-49), { time, sensorValue: Math.random() * 100 }]);
      }, 1000);

      return () => clearInterval(interval);
    }
  }, [isConnected]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    if (isRunning) {
      timer = setInterval(() => {
        setElapsedTime((prevTime) => prevTime + 1);
      }, 1000);
    } else if (timer) {
      clearInterval(timer);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isRunning]);

  const handleStart = () => {
    setIsRunning(true);
    setElapsedTime(0);
  };

  const handleStop = () => {
    setIsRunning(false);
  };

  return (
    <div className={styles.container}>
    <div className={styles.header}>
      <img src="/mms_logo_2.png" alt="App Logo" className={styles.logo} />
      <h1 className={styles.heading}>MMS - For Trial Only</h1>
    </div>

    <div className={styles.topContainer}>
      <div className={styles.buttonContainer}>
        <BluetoothControl />
      </div>
      {isConnected && (
        <div className={styles.controlBox}>
          <h2>Search Algorithm Control</h2>
          <button className={styles.button} onClick={handleStart}>Start</button>
          <button className={styles.button} onClick={handleStop}>Stop</button>
          <p>Elapsed Time: {elapsedTime} seconds</p>
        </div>
      )}
    </div>

      {isConnected && (
        <div className={styles.contentContainer}>
          <div className={styles.leftPanel}>
            <div className={styles.electrodeBox}>
              <h2>Electrode Pair Selection</h2>
              <p>Optimized pair will be displayed here after processing.</p>
              <div>
                <span>Pair: </span>
                <span className={`${styles.valueBox} ${styles.blue}`}>(3,5)</span>
              </div>
            </div>

            <div className={styles.intensityBox}>
              <h2>Current Intensity</h2>
              <p>Current applied to electrodes.</p>
              <div>
                <span>Current: </span>
                <span className={`${styles.valueBox} ${styles.orange}`}>8.0 mA</span>
              </div>
              <div style={{ marginTop: "1rem" }}></div>
              <div className={styles.inputContainer}>
                <label>Min Current (mA): </label>
                <input
                  type="number"
                  value={minCurrent}
                  onChange={(e) => setMinCurrent(Number(e.target.value))}
                  className={styles.inputBox}
                />
              </div>
              <div className={styles.inputContainer}>
                <label>Max Current (mA): </label>
                <input
                  type="number"
                  value={maxCurrent}
                  onChange={(e) => setMaxCurrent(Number(e.target.value))}
                  className={styles.inputBox}
                />
              </div>
            </div>
          </div>

          <div className={styles.rightPanel}>
            <div className={styles.chartContainer}>
              <h3>Sensor 1 Readings</h3>
              <LineChart width={600} height={200} data={sensor1Data}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="time" tickFormatter={(time) => new Date(time).toLocaleTimeString()} />
                <YAxis domain={[0, 100]} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="sensorValue" stroke="#8884d8" strokeWidth={2} />
              </LineChart>
            </div>

            <div className={styles.chartContainer}>
              <h3>Sensor 2 Readings</h3>
              <LineChart width={600} height={200} data={sensor2Data}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="time" tickFormatter={(time) => new Date(time).toLocaleTimeString()} />
                <YAxis domain={[0, 100]} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="sensorValue" stroke="#82ca9d" strokeWidth={2} />
              </LineChart>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default NMESControlPanel;
