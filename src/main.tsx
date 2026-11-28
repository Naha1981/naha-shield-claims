import {WorkspaceNotice} from './components/WorkspaceNotice';
import React from 'react';
const PublicReview = React.lazy(() => import('./components/PublicReview').then(m => ({ default: m.PublicReview })));
const PublicMapPreview = React.lazy(() => import('./components/PublicMapPreview').then(m => ({ default: m.PublicMapPreview })));
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {ErrorBoundary} from './components/ErrorBoundary.tsx';
import './index.css';

try { const theme=localStorage.getItem('nahashield-theme')==='dark'?'dark':'light';document.documentElement.dataset.theme=theme;document.documentElement.classList.toggle('dark',theme==='dark'); } catch {document.documentElement.dataset.theme='light';}
async function mount(){
await fetch('/api/workspace');
createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    {location.pathname.startsWith('/review')?<React.Suspense fallback={null}><WorkspaceNotice/><PublicReview module={location.pathname.split('/')[2]||'workforce'}/></React.Suspense>:location.pathname==='/map-preview'?<React.Suspense fallback={null}><WorkspaceNotice/><PublicMapPreview/></React.Suspense>:<App/>}
  </ErrorBoundary>,
);

}
void mount();
