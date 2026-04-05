const fs = require('fs');
const path = 'components/HoldingsTab.tsx';
let content = fs.readFileSync(path, 'utf8');
const marker = 'function Label({ children }: { children: React.ReactNode }) { return <label className="text-[10px] font-black opacity-30 uppercase tracking-widest ml-1 mb-1 block">{children}</label> }';
const index = content.indexOf(marker);
if (index !== -1) {
    fs.writeFileSync(path, content.substring(0, index + marker.length), 'utf8');
    console.log('Successfully truncated the file at the first occurrence of Label component.');
} else {
    console.log('Marker not found.');
}
