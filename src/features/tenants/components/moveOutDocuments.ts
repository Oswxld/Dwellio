import type { MoveOutCharge } from '../data/moveOutRepository'

export type MoveOutDocument = {
  invoiceNumber: string
  final: boolean
  arrearSources: Array<{ invoiceNumber: string; amount: number }>
  tenantName: string
  phone: string
  property: string
  unit: string
  date: string
  charges: MoveOutCharge[]
  previousArrears: number | null
  deposit: number
  applied: number | null
  refundable: number | null
  payable: number | null
}

const amount = (value:number|null) => value == null || !Number.isFinite(value)
  ? 'Unavailable' : 'KSh '+value.toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2})

// Browser-native, self-contained PDF writer (no third-party CDN).
// The document is explicitly marked DRAFT until final invoice persistence
// and settlement verification are implemented on the server.
function pdfSafe(text:string) {
  return text.normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[\u2010-\u2015]/g,'-').replace(/[\u2018\u2019]/g,"'")
    .replace(/[\u201c\u201d]/g,'"').replace(/[^\x20-\x7e]/g,'?')
}
function encode(text:string) {return new TextEncoder().encode(text)}
function escapePdf(text:string) {
  return pdfSafe(text).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)')
}
function wrap(text:string,max=90) {
  const words = pdfSafe(text).split(/\s+/)
  const lines:string[]=[]
  let line=''
  for(const word of words) {
    if ((line+' '+word).trim().length>max && line) {lines.push(line);line=''}
    line=(line+' '+word).trim()
    while(line.length>max){lines.push(line.slice(0,max));line=line.slice(max)}
  }
  if(line)lines.push(line)
  return lines.length?lines:['']
}
function createPdf(doc:MoveOutDocument):Blob {
  const entries:string[]=[
    'DWELLIO - MOVE-OUT SETTLEMENT',
    doc.final ? 'OFFICIAL FINAL MOVE-OUT STATEMENT' : 'DRAFT - NOT AN ISSUED FINANCIAL INVOICE',
    '',
    'Property: '+doc.property,
    'Unit: '+doc.unit,
    'Tenant: '+doc.tenantName,
    'Phone: '+doc.phone,
    'Inspection date: '+doc.date,
    'Invoice number: '+doc.invoiceNumber,
    '',
    'ITEMIZED INSPECTION CHARGES',
    ...doc.charges.flatMap((c,i)=>[
      `${i+1}. ${c.title}       ${amount(c.amount)}`,
      ...(c.description?['   '+c.description]:[]),
    ]),
    '',
    'ORIGINAL UNPAID INVOICES',
    ...doc.arrearSources.map(src => src.invoiceNumber + ': '+ amount(src.amount)),
    '',
    doc.final ? 'FINAL FINANCIAL SETTLEMENT' : 'FINANCIAL PREVIEW (NOT RECONCILED)',
    'Inspection charges: '+amount(doc.charges.reduce((s,c)=>s+c.amount,0)),
    'Historical account balance: '+amount(doc.previousArrears),
    'Agreed security deposit: '+amount(doc.deposit),
    'Deposit applied: '+amount(doc.applied),
    'Tenant amount payable: '+amount(doc.payable),
    'Deposit refundable: '+amount(doc.refundable),
    '',
    'The landlord handles refunds outside Dwellio. No B2C transfer was made.',
    ...(doc.final ? [
      'The statement is finalized; refund transfer is NOT automatic.',
      'Any tenant payable remains due until properly receipted.',
    ] : [
      'This draft does not constitute a finalized invoice or payment receipt.',
      'Final amounts require verified invoice-line sources, payments and deposits.',
    ]),
  ]
  const lines=entries.flatMap(row=>wrap(row,88))
  const pages:string[][]=[]
  for(let i=0;i<lines.length;i+=42)pages.push(lines.slice(i,i+42))
  const objects:string[]=[]
  const add=(body:string)=>{objects.push(body);return objects.length}
  const catalogId=add('')
  const pagesId=add('')
  const fontId=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  const kids:number[]=[]
  for(let pageIndex=0;pageIndex<pages.length;pageIndex++){
    const commands:string[]=['BT','/F1 10 Tf','14 TL','50 790 Td']
    pages[pageIndex].forEach((line,index)=>{
      if(index>0)commands.push('T*')
      commands.push(`(${escapePdf(line)}) Tj`)
    })
    commands.push('ET')
    const stream=commands.join('\n')+'\n'
    const streamId=add(`<< /Length ${encode(stream).length} >>\nstream\n${stream}endstream`)
    const pageId=add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${streamId} 0 R >>`)
    kids.push(pageId)
  }
  objects[catalogId-1]=`<< /Type /Catalog /Pages ${pagesId} 0 R >>`
  objects[pagesId-1]=`<< /Type /Pages /Kids [${kids.map(x=>x+' 0 R').join(' ')}] /Count ${kids.length} >>`
  const parts:string[]=['%PDF-1.4\n']
  const offsets:number[]=[0]
  let bytePosition=encode(parts[0]).length
  objects.forEach((body,i)=>{
    offsets.push(bytePosition)
    const part=`${i+1} 0 obj\n${body}\nendobj\n`
    parts.push(part)
    bytePosition+=encode(part).length
  })
  const xrefPos=bytePosition
  parts.push(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`)
  for(const offset of offsets.slice(1))parts.push(String(offset).padStart(10,'0')+' 00000 n \n')
  parts.push(`trailer\n<< /Size ${objects.length+1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefPos}\n%%EOF`)
  return new Blob([encode(parts.join(''))],{type:'application/pdf'})
}

export function downloadMoveOutDraftPdf(doc:MoveOutDocument) {
  const url=URL.createObjectURL(createPdf(doc))
  const link=document.createElement('a')
  link.href=url
  link.download = doc.final
    ? `Dwellio_Final_Settlement_${doc.invoiceNumber.replace(/[^a-z0-9_-]+/gi,'_')}.pdf`
    : `Dwellio_Move_Out_Draft_${doc.tenantName.trim().replace(/[^a-z0-9]+/gi,'_')}.pdf`
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(()=>URL.revokeObjectURL(url),30000)
}

export function printMoveOutDraft(doc:MoveOutDocument) {
  const url=URL.createObjectURL(createPdf(doc))
  const opened=window.open(url,'_blank','noopener,noreferrer')
  if(!opened) {
    URL.revokeObjectURL(url)
    throw new Error('Allow pop-ups to open the PDF for printing.')
  }
  window.setTimeout(()=>URL.revokeObjectURL(url),60000)
}
