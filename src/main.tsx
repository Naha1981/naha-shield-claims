import {WorkspaceNotice} from './components/WorkspaceNotice';
import{PublicReview}from'./components/PublicReview';
import{PublicMapPreview}from'./components/PublicMapPreview';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {ErrorBoundary} from './components/ErrorBoundary.tsx';
import './index.css';

try { const theme=localStorage.getItem('nahashield-theme')==='dark'?'dark':'light';document.documentElement.dataset.theme=theme;document.documentElement.classList.toggle('dark',theme==='dark'); } catch {document.documentElement.dataset.theme='light';}
async function mount(){
await fetch('/api/workspace');
createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    {location.pathname.startsWith('/review')?<><WorkspaceNotice/><PublicReview module={location.pathname.split('/')[2]||'workforce'}/></>:location.pathname==='/map-preview'?<><WorkspaceNotice/><PublicMapPreview/></>:<App/>}
  </ErrorBoundary>,
);

}
void mount();
