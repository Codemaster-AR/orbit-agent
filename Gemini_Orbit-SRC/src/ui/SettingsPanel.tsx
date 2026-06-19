import React, { useState, useEffect } from 'react';

const SettingsPanel = () => {
  const [disableWarnings, setDisableWarnings] = useState(false);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        if (window.electronAPI && window.electronAPI.security) {
          const securitySettings = await window.electronAPI.security.getSettings();
          setDisableWarnings(securitySettings.disableSecurityWarnings || false);
        } else {
          console.warn("electronAPI.security not available.");
        }
      } catch (error) {
        console.error("Failed to load security settings:", error);
      }
    };
    loadSettings();
  }, []);

  const handleToggleWarnings = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newState = e.target.checked;
    setDisableWarnings(newState);
    if (window.electronAPI && window.electronAPI.security) {
      window.electronAPI.security.updateSetting('disableSecurityWarnings', newState);
    }
  };

  return (
    <div style={{ padding: '20px', color: '#ccc' }}>
      <h3>Security Settings</h3>
      <label>
        <input
          type="checkbox"
          checked={disableWarnings}
          onChange={handleToggleWarnings}
        />
        Disable Security Warnings
      </label>
    </div>
  );
};

export default SettingsPanel;
