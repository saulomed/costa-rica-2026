// currency.js — Conversão USD → BRL para Costa Rica 2026
(function() {
  const CK = 'cr2026_fx', TTL = 4 * 3600000; // cache 4h

  // Parse número: "2.150" (milhar pt-BR) → 2150, "110" → 110
  function pn(s) {
    s = s.trim();
    return /^\d{1,3}(\.\d{3})+$/.test(s) ? parseInt(s.replace(/\./g, '')) : parseFloat(s);
  }

  // Formata BRL: 2150 → "2.150"
  function fr(n) {
    n = Math.round(n);
    return n >= 1000 ? n.toLocaleString('pt-BR') : String(n);
  }

  // Converte texto USD para BRL: "~US$ 110/noite" → "~R$ 638/noite"
  function cvt(text, r) {
    return text
      .replace(/(~?\s*)US\$\s*([\d.]+)(\s*[–-]\s*)([\d.]+)/g,
        (_, p, a, sep, b) => `${p}R$ ${fr(pn(a)*r)}${sep}${fr(pn(b)*r)}`)
      .replace(/(~?\s*)US\$\s*([\d.]+)/g,
        (_, p, a) => `${p}R$ ${fr(pn(a)*r)}`);
  }

  window.BRL_RATE = null;
  window.CRC_RATE = null;

  // Retorna texto BRL puro: "~US$ 110/noite" → "~R$ 638/noite"
  window.toBrlText = function(t) {
    return window.BRL_RATE ? cvt(t, window.BRL_RATE) : '';
  };

  // Substitui US$ inline em HTML, adicionando span BRL após cada ocorrência
  window.withBrl = function(html) {
    if (!window.BRL_RATE) return html;
    return html.replace(
      /(~?\s*US\$\s*[\d.]+(?:\s*[–-]\s*[\d.]+)?(?:\/\w+)?)/g,
      function(m) {
        var b = cvt(m, window.BRL_RATE);
        return b !== m ? m + ' <span class="brl">· ' + b + '</span>' : m;
      }
    );
  };

  // Aplica conversão BRL em elementos do DOM (para páginas estáticas)
  window.applyBrlConversion = function(root) {
    if (!window.BRL_RATE) return;
    root = root || document;
    var r = window.BRL_RATE;

    // Remove conversões anteriores
    root.querySelectorAll('.brl').forEach(function(e) { e.remove(); });

    // Preços em bloco: hotel-price, insurance-price, cost amounts
    root.querySelectorAll('.hotel-price, .insurance-price, .cost-card .amount, .cost-total .amount').forEach(function(el) {
      var t = (el.childNodes[0] && el.childNodes[0].textContent || '').trim();
      if (!t || t.indexOf('US$') === -1) return;
      var b = cvt(t, r);
      if (b === t) return;
      var s = document.createElement('span');
      s.className = 'brl';
      s.textContent = b;
      el.appendChild(s);
    });

    // Price values em rental cards (com possível visa-tag filho)
    root.querySelectorAll('.price-value').forEach(function(el) {
      var visa = el.querySelector('.visa-tag');
      var t = '';
      el.childNodes.forEach(function(n) { if (n.nodeType === 3) t += n.textContent; });
      t = t.trim();
      if (!t || t.indexOf('US$') === -1) return;
      var b = cvt(t, r);
      if (b === t) return;
      var s = document.createElement('span');
      s.className = 'brl';
      s.textContent = ' · ' + b;
      if (visa) el.insertBefore(s, visa); else el.appendChild(s);
    });

    // Texto inline com preços (li, p em seções estáticas)
    root.querySelectorAll('.alert-card li, .insurance-card p, .recommendation p, .coverage-col li, .tip-card p').forEach(function(el) {
      if (el.textContent.indexOf('US$') === -1) return;
      el.dataset.orig = el.dataset.orig || el.innerHTML;
      el.innerHTML = el.dataset.orig.replace(
        /(~?\s*US\$\s*[\d.]+(?:\s*[–-]\s*[\d.]+)?(?:\/\w+)?)/g,
        function(m) {
          var b = cvt(m.trim(), r);
          return b !== m.trim() ? m + ' <span class="brl">· ' + b + '</span>' : m;
        }
      );
    });

    // Price tags
    root.querySelectorAll('.price-tag').forEach(function(el) {
      if (el.querySelector('.brl')) return;
      var m = el.textContent.match(/US\$\s*[\d.]+(?:\s*[–-]\s*[\d.]+)?(?:\/\w+)?/);
      if (!m) return;
      var b = cvt(m[0], r);
      if (b === m[0]) return;
      var s = document.createElement('span');
      s.className = 'brl';
      s.textContent = ' · ' + b;
      el.appendChild(s);
    });

    // Barra de câmbio
    var bar = document.getElementById('rate-bar');
    if (bar) {
      bar.textContent = '1 USD = ' + r.toFixed(2) + ' BRL · Cotação atualizada automaticamente';
      bar.classList.add('visible');
    }
  };

  // Busca e cacheia a cotação
  async function init() {
    var rate = null, crcRate = null;
    try {
      var c = JSON.parse(localStorage.getItem(CK));
      if (c && Date.now() - c.ts < TTL) { rate = c.rate; crcRate = c.crc || null; }
    } catch(e) {}

    if (!rate || !crcRate) {
      try {
        var res = await fetch('https://open.er-api.com/v6/latest/USD');
        var d = await res.json();
        rate = d.rates && d.rates.BRL;
        crcRate = d.rates && d.rates.CRC;
        if (rate) localStorage.setItem(CK, JSON.stringify({ rate: rate, crc: crcRate || null, ts: Date.now() }));
      } catch(e) {}
    }

    if (rate) {
      window.BRL_RATE = rate;
      window.CRC_RATE = crcRate;
      window.applyBrlConversion();
      window.dispatchEvent(new CustomEvent('brl-ready'));
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
