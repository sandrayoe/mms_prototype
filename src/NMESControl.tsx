import React from "react";
import { useBluetooth } from "./BluetoothContext";
import BluetoothControl from "./BluetoothControl";
import styles from "./NMESControlPanel.module.css"; // Import CSS Module

const NMESControlPanel: React.FC = () => {
  const { isConnected } = useBluetooth();

  return (
    <div className={styles.container}>
      {/* Logo and Header */}
      <div className={styles.leftColumn}>
        <img src="/mms_logo_2.png" alt="App Logo" className={styles.logo} />
        <h1 className={styles.heading}>MMS - For Trial Only</h1>
      </div>

      {/* Bluetooth Buttons */}
      <div className={styles.buttonContainer}>
        <BluetoothControl />
      </div>

      {isConnected && (
        <>
          {/* Electrode Selection */}
          <div className={styles.electrodeBox}>
            <h2>Electrode Pair Selection</h2>
            <p>Optimized pair will be displayed here after processing.</p>
            <div>
              <span>Pair:</span>
              <span className={`${styles.valueBox} ${styles.blue}`}>(3,5)</span>
            </div>
          </div>

          {/* Current Intensity */}
          <div className={styles.intensityBox}>
            <h2>Current Intensity</h2>
            <p>Current applied to electrodes.</p>
            <div>
              <span>Current:</span>
              <span className={`${styles.valueBox} ${styles.orange}`}>8.0 mA</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default NMESControlPanel;

