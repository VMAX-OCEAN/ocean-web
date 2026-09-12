import { useState } from 'react';
import * as Cesium from 'cesium';
import { CesiumViewer } from './components/CesiumViewer';
import { ZoomControls } from './components/ZoomControls';
import { LocationSearch } from './components/LocationSearch';

function App() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<Cesium.Viewer | null>(null);

  return (
    <div className="app">
      <CesiumViewer
        onReady={(v) => {
          setViewer(v);
          setLoading(false);
        }}
        onError={(msg) => setError(msg)}
      />

      <LocationSearch viewer={viewer} />
      <ZoomControls viewer={viewer} />

      {loading && !error && (
        <div className="loading-overlay">
          <div className="loading-spinner" />
          <div className="loading-text">Loading globe…</div>
        </div>
      )}

      {error && (
        <div className="error-overlay">
          <div className="error-text">⚠️ {error}</div>
        </div>
      )}
    </div>
  );
}

export default App;
