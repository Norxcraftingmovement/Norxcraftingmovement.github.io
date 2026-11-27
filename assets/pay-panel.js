/* NORX dynamic PromptPay panel. Shown only when the server returns a `payment` block (QR is configured and verified by the owner);
   otherwise the existing bank-transfer instructions are untouched. A QR is a payment REQUEST: the order is confirmed only after the NORX team verifies the transfer. */
(function () {
  'use strict';
  var el = function (t, c, x) { var n = document.createElement(t); if (c) n.className = c; if (x !== undefined) n.textContent = x; return n; };
  var baht = function (n) { return Number(n).toLocaleString('th-TH') + ' บาท'; };
  var when = function (s) { var d = new Date(s); return d.toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric' }) + ' · ' + d.toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' }) + ' น.'; };
  function png(img, p, orderNo) {
    var c = document.createElement('canvas'), s = 1024; c.width = s; c.height = s + 220; var x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, s, s);
    x.fillStyle = '#000'; x.textAlign = 'center'; x.font = 'bold 48px sans-serif'; x.fillText('NORX · ' + orderNo, s / 2, s + 70);
    x.font = '44px sans-serif'; x.fillText(baht(p.amount) + ' · ' + p.payeeName, s / 2, s + 135); x.font = '32px sans-serif'; x.fillText('ชำระภายใน ' + when(p.deadline), s / 2, s + 190);
    c.toBlob(function (b) { var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = orderNo + '-QR.png'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000); }, 'image/png');
  }
  function build(orderNo, p) {
    var box = el('section', 'dyn-pay'); box.id = 'dynamicPay'; box.setAttribute('aria-label', 'QR สำหรับชำระเงิน');
    box.style.cssText = 'text-align:center;margin:0 0 16px;padding:0 0 16px;border-bottom:1px solid currentColor';
    box.appendChild(el('p', 'qr-label', 'สแกนเพื่อชำระเงิน (PromptPay · QR เฉพาะออเดอร์นี้)'));
    var img = new Image(); img.alt = 'QR PromptPay ออเดอร์ ' + orderNo + ' ยอด ' + baht(p.amount); img.width = 280; img.height = 280; img.style.cssText = 'background:#fff;max-width:100%;height:auto'; img.src = p.qrUrl; box.appendChild(img);
    var l = el('p'); l.style.cssText = 'margin:10px 0 0;line-height:1.7';
    [['เลขออเดอร์', orderNo], ['ยอดที่ต้องโอน', baht(p.amount)], ['ผู้รับเงิน', p.payeeName], ['ชำระภายใน', when(p.deadline)]].forEach(function (r, i) { if (i) l.appendChild(document.createElement('br')); var b = el('b', '', r[0] + ': '); l.appendChild(b); l.appendChild(document.createTextNode(r[1])); });
    box.appendChild(l);
    var row = el('p'); row.style.margin = '12px 0 0';
    var b1 = el('button', 'btn alt', 'ดาวน์โหลด QR (PNG)'); b1.type = 'button'; b1.onclick = function () { png(img, p, orderNo); };
    var a2 = el('a', 'btn alt', 'ดาวน์โหลด (SVG)'); a2.href = p.downloadUrl; a2.style.marginLeft = '8px'; row.appendChild(b1); row.appendChild(a2); box.appendChild(row);
    var n = el('p', 'small', 'ตรวจชื่อผู้รับและยอดเงินในแอปธนาคารก่อนกดยืนยัน · ระบบยังไม่ยืนยันการชำระอัตโนมัติ กรุณาส่งสลิปพร้อมเลขออเดอร์ทางแชทเพจ NORX เพื่อให้ทีมงานตรวจสอบ'); n.style.margin = '10px 0 0'; box.appendChild(n);
    return box;
  }
  /* checkout success view (hooked by shop.js) */
  window.NORX_PAY_RENDER = function (r) {
    var p = r && r.payment, bank = document.querySelector('#payment .bank'); if (!p || !bank) return;
    var old = document.getElementById('dynamicPay'); if (old) old.remove();
    bank.insertBefore(build(r.id, p), bank.firstChild);
    Array.prototype.forEach.call(bank.querySelectorAll('.qr-label:not(#dynamicPay .qr-label), img.qr, .qr-hint'), function (n) { n.hidden = true; n.style.display = 'none'; });
    var first = bank.querySelector('#bankName'); if (first && !document.getElementById('bankFallback')) { var f = el('p', 'small', 'หรือโอนผ่านเลขบัญชี'); f.id = 'bankFallback'; first.parentNode.insertBefore(f, first); }
  };
  /* standalone /pay/ page */
  window.NORX_PAY_PAGE = function (root, status) {
    var q = new URLSearchParams(location.search), o = q.get('o'), t = q.get('t');
    if (!o || !t) { status.textContent = 'ลิงก์ไม่ถูกต้อง'; return; }
    fetch('/api/orders/pay?o=' + encodeURIComponent(o) + '&t=' + encodeURIComponent(t), { credentials: 'same-origin' }).then(function (r) { if (!r.ok) throw new Error('nf'); return r.json(); }).then(function (v) {
      var s = v.payment.state; root.textContent = '';
      var msg = { paid: 'ได้รับการยืนยันการชำระเงินแล้ว ขอบคุณครับ', cancelled: 'ออเดอร์นี้ถูกยกเลิกแล้ว', on_site: 'ออเดอร์นี้ชำระหน้างาน ไม่ต้องโอนล่วงหน้า', expired: 'เลยกำหนดชำระแล้ว กรุณาติดต่อเพจ NORX', unavailable: 'ยังไม่เปิดให้ชำระด้วย QR กรุณาโอนผ่านเลขบัญชีและส่งสลิปทางแชทเพจ', revoked: 'QR นี้ถูกยกเลิกโดยทีมงาน ห้ามโอนตาม QR เดิม กรุณาติดต่อเพจ NORX เพื่อรับวิธีชำระเงินใหม่' }[s];
      status.textContent = msg || '';
      if (s === 'awaiting') root.appendChild(build(v.order.id, v.payment));
      if (s === 'unavailable' || s === 'expired' || s === 'revoked') { var d = el('p', '', 'ยอด ' + baht(v.order.total) + ' · ออเดอร์ ' + v.order.id); root.appendChild(d); }
      if (v.bank && (s === 'awaiting' || s === 'unavailable')) { var b = el('p', 'small'); b.textContent = 'โอนผ่านเลขบัญชี: ' + v.bank.name + ' ' + v.bank.account + ' · ' + v.bank.holder; root.appendChild(b); }
    }).catch(function () { status.textContent = 'ไม่พบออเดอร์หรือลิงก์หมดอายุ'; });
  };
})();
