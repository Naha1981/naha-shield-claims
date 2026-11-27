export {analyzeCaseText} from './analyzer.js';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import ExcelJS from 'exceljs';
import {scanHistoricalPayments} from './historicalSynthetic.ts';
export {scanHistoricalPayments};
pdfjs.GlobalWorkerOptions.workerSrc=typeof window==='undefined'?new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',import.meta.url).href:'/synthetic/assets/pdf.worker.mjs';
export async function extractPdf(bytes){
 if(new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw Error('Invalid PDF signature.');
 const task=pdfjs.getDocument({data:new Uint8Array(bytes),isEvalSupported:false,stopAtErrors:true,useSystemFonts:true});
 let doc;try{doc=await task.promise;if(doc.numPages>100)throw Error('Limit:100 pages per file.');const pages=[];for(let i=1;i<=doc.numPages;i++){const page=await doc.getPage(i),data=await page.getTextContent();pages.push({page:i,text:data.items.map(x=>x.str||'').join('\n')});}if(pages.every(x=>x.text.trim().length<40))throw Error('No usable PDF text. Scanned images need OCR, which is not enabled.');return{pages,text:pages.map(x=>`PAGE ${x.page}\n${x.text}`).join('\n\n'),page_count:doc.numPages};}finally{await task.destroy();}
}
export function parseCsv(text){
 const lines=[];let row=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(cell);cell='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(Boolean))lines.push(row);row=[];cell='';}else cell+=c;}
 if(quoted)throw Error('Unclosed CSV quotation.');if(cell||row.length){row.push(cell);lines.push(row);}if(!lines.length)throw Error('Empty CSV.');const head=lines.shift().map(x=>x.trim());if(new Set(head).size!==head.length)throw Error('Duplicate CSV columns.');return lines.map((values,i)=>{if(values.length!==head.length)throw Error(`CSV row ${i+2} has wrong column count.`);return Object.fromEntries(head.map((k,j)=>[k,values[j]]));});
}
function normalizeRows(rows){
 const reverse={'Data classification':'dataset_label'};
 const needed=['dataset_label','payment_id','claim_id','supplier_alias','invoice_ref','invoice_total_cents','approved_gross_cents','contractual_excess_cents','paid_cents','payment_date','notification_date','loss_date','required_documents','received_documents'];
 const rawNames=new Set(Object.keys(rows[0]||{}));const formatted=rawNames.has('Data classification');
 const mapped=rows.map((r,i)=>{const out={};for(const[k,v]of Object.entries(r)){let key=reverse[k]||k;if(formatted&&!reverse[k])key=k.replace(' (ZAR)',' Cents').toLowerCase().replaceAll(' ','_');let value=v;if(v instanceof Date)value=v.toISOString().slice(0,10);if(key.endsWith('_cents')){const n=Number(v);if(!Number.isFinite(n))throw Error(`Invalid amount at row ${i+1}`);value=formatted?Math.round(n*100):n;}out[key]=value;}for(const k of needed)if(out[k]===undefined||out[k]===null)throw Error(`Missing column ${k}`);return out;});
 if(!mapped.length||mapped.length>5000)throw Error('Import 1 to5,000synthetic rows.');return mapped;
}
export async function importRegister(bytes,name){
 if(name.toLowerCase().endsWith('.csv'))return normalizeRows(parseCsv(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
 if(!name.toLowerCase().endsWith('.xlsx'))throw Error('Use XLSX or CSV for a payment register.');
 if(bytes[0]!==80||bytes[1]!==75)throw Error('Invalid XLSX signature.');
 const wb=new ExcelJS.Workbook();await wb.xlsx.load(bytes,{ignoreNodes:['tableParts']});if(wb.worksheets.length!==1)throw Error('Use a single payment worksheet without answer keys.');const ws=wb.worksheets[0];if(ws.rowCount>5010||ws.columnCount>60)throw Error('Workbook exceeds test import limit.');let header;const out=[];ws.eachRow(row=>{const vals=row.values.slice(1).map(v=>{if(v&&typeof v==='object'&&!(v instanceof Date))throw Error('Formulas, rich objects or links are not supported in the input sheet.');return v});if(!header){if(vals.includes('Data classification')||vals.includes('dataset_label'))header=vals;return;}if(!vals.some(v=>v!==null&&v!==undefined))return;out.push(Object.fromEntries(header.map((h,i)=>[h,vals[i]])));});return normalizeRows(out);
}
