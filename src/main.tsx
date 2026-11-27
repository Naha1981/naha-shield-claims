import {WorkspaceNotice} from './components/WorkspaceNotice';
import{PublicReview}from'./components/PublicReview';
import{PublicMapPreview}from'./components/PublicMapPreview';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {ErrorBoundary} from './components/ErrorBoundary.tsx';
import './index.css';

async function mount(){
await fetch('/api/workspace');
createRoot(document.getElementById('root')!).render(
  <ErrorBoundary><WorkspaceNotice/>
    {location.pathname.startsWith('/review')?<PublicReview module={location.pathname.split('/')[2]||'workforce'}/>:location.pathname==='/map-preview'?<PublicMapPreview/>:<App/>}
  </ErrorBoundary>,
);

}
void mount();
