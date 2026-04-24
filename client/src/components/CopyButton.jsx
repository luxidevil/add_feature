import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

export default function CopyButton({ text, label = 'Copy' }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border text-xs font-medium text-gray-300 hover:text-white transition-colors"
      style={{ backgroundColor: '#2a2a2a', borderColor: '#444' }}
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? 'Copied!' : label}
    </button>
  );
}
