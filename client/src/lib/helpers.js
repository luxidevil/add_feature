import * as XLSX from 'xlsx';

export function parseEmailList(text, defaultCountry, defaultProxy) {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      // Find first colon — separates email from the rest
      const idx1 = line.indexOf(':');
      if (idx1 === -1) {
        // Just email — no colon at all
        const email = line.trim();
        if (!email) return null;
        return { email, country: (defaultCountry || 'US').toUpperCase(), proxyUrl: defaultProxy || undefined };
      }

      const email = line.slice(0, idx1).trim();
      if (!email) return null;
      const remainder = line.slice(idx1 + 1);

      // If remainder starts with http:// or https:// it's a direct proxy URL (no country inline)
      if (remainder.startsWith('http://') || remainder.startsWith('https://')) {
        return { email, country: (defaultCountry || 'US').toUpperCase(), proxyUrl: remainder || defaultProxy || undefined };
      }

      // Otherwise remainder is "COUNTRY" or "COUNTRY:PROXY_URL"
      const idx2 = remainder.indexOf(':');
      if (idx2 === -1) {
        // Just a country code
        const country = remainder.trim();
        return { email, country: (country || defaultCountry || 'US').toUpperCase(), proxyUrl: defaultProxy || undefined };
      }

      // country:proxy_url — country is before first colon, everything after is the proxy URL
      const country = remainder.slice(0, idx2).trim();
      const proxyUrl = remainder.slice(idx2 + 1).trim();
      return {
        email,
        country: (country || defaultCountry || 'US').toUpperCase(),
        proxyUrl: proxyUrl || defaultProxy || undefined,
      };
    })
    .filter(Boolean);
}

export function parseCPList(text, defaultPassword, defaultCountry, defaultProxy) {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const parts = line.split('|');
      const resetUrl = parts[0].trim();
      if (!resetUrl) return null;
      const newPassword = parts[1]?.trim() || defaultPassword || '';
      const country = parts[2]?.trim() || defaultCountry || undefined;
      const proxyUrl = parts[3]?.trim() || defaultProxy || undefined;
      return newPassword ? { resetUrl, newPassword, country, proxyUrl } : null;
    })
    .filter(Boolean);
}

export function exportXlsx(data, sheetName, filename) {
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
}

export async function runConcurrent(tasks, concurrency, signal, onResult, onProgress) {
  let idx = 0;
  let completed = 0;
  let active = 0;
  const total = tasks.length;

  await new Promise((resolve, reject) => {
    function next() {
      if (signal?.aborted) {
        if (active === 0) resolve();
        return;
      }

      while (active < concurrency && idx < total) {
        const i = idx++;
        active++;
        onProgress?.(completed, total, active);

        tasks[i]()
          .then(result => {
            if (!signal?.aborted) onResult(result, i);
            active--;
            completed++;
            onProgress?.(completed, total, active);
            next();
            if ((completed === total || (signal?.aborted && active === 0))) resolve();
          })
          .catch(err => {
            active--;
            completed++;
            onProgress?.(completed, total, active);
            if (signal?.aborted) {
              if (active === 0) resolve();
            } else {
              reject(err);
            }
          });
      }

      if (idx >= total && active === 0) resolve();
    }

    next();
  });
}

export function cn(...classes) {
  return classes.filter(Boolean).join(' ');
}
