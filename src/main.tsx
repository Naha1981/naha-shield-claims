import{PublicMapPreview}from'./components/ExecutionView';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {ErrorBoundary} from './components/ErrorBoundary.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    {location.pathname==='/map-preview'?<PublicMapPreview/>:<App/>}
  </ErrorBoundary>,
);
