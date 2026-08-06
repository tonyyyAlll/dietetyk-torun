/**
 * Widget rezerwacji — Przyjazny Dietetyk
 * Użycie: <div id="rs-booking-widget" data-api="https://TWOJA-DOMENA/api/api.php"></div>
 *         <script src=".../booking-widget.js" defer></script>
 */
(function () {
  'use strict';

  var MONTHS_PL = ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'];
  var DAYS_PL = ['Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob', 'Niedz'];

  function init() {
    var root = document.getElementById('rs-booking-widget');
    if (!root) return;

    var apiUrl = root.getAttribute('data-api');
    if (!apiUrl) {
      root.innerHTML = '<p style="color:#ef4444">Błąd konfiguracji widgetu: brak data-api.</p>';
      return;
    }

    var presetPackage = new URLSearchParams(window.location.search).get('package');

    var state = {
      step: 1,
      locations: [],
      services: [],
      locationId: null,
      serviceId: presetPackage || null,
      calendarMonth: new Date(),
      selectedDate: null,
      slots: [],
      selectedTime: null,
    };

    injectStyles();
    root.innerHTML = '<div class="rsbw"><div class="rsbw-steps"></div><div class="rsbw-body"></div></div>';

    function api(action, opts) {
      opts = opts || {};
      var url = apiUrl + '?action=' + action + (opts.query ? '&' + opts.query : '');
      var fetchOpts = { method: opts.method || 'GET' };
      if (opts.body) {
        fetchOpts.method = 'POST';
        fetchOpts.headers = { 'Content-Type': 'application/json' };
        fetchOpts.body = JSON.stringify(opts.body);
      }
      return fetch(url, fetchOpts).then(function (r) { return r.json(); });
    }

    function render() {
      renderStepIndicator();
      var body = root.querySelector('.rsbw-body');
      body.innerHTML = '';
      if (state.step === 1) renderLocationStep(body);
      else if (state.step === 2) renderServiceStep(body);
      else if (state.step === 3) renderCalendarStep(body);
      else if (state.step === 4) renderTimeStep(body);
      else if (state.step === 5) renderFormStep(body);
      else if (state.step === 6) renderConfirmStep(body);
    }

    function renderStepIndicator() {
      var wrap = root.querySelector('.rsbw-steps');
      var labels = ['Lokalizacja', 'Usługa', 'Data', 'Godzina', 'Dane', 'Gotowe'];
      wrap.innerHTML = labels.map(function (label, i) {
        var n = i + 1;
        var cls = 'rsbw-step';
        if (n < state.step) cls += ' done';
        if (n === state.step) cls += ' active';
        return '<div class="' + cls + '"><span class="rsbw-step-num">' + n + '</span><span class="rsbw-step-label">' + label + '</span></div>';
      }).join('<div class="rsbw-step-line"></div>');
    }

    function renderLoading(container) {
      container.innerHTML = '<div class="rsbw-loading">Ładowanie&hellip;</div>';
    }

    // KROK 1 — Lokalizacja
    function renderLocationStep(container) {
      renderLoading(container);
      api('locations').then(function (res) {
        if (!res.success) { container.innerHTML = errorBox(res.error); return; }
        state.locations = res.locations;
        container.innerHTML = '<h3 class="rsbw-title">Wybierz lokalizację</h3><div class="rsbw-grid"></div>';
        var grid = container.querySelector('.rsbw-grid');
        state.locations.forEach(function (loc) {
          var card = document.createElement('button');
          card.type = 'button';
          card.className = 'rsbw-card';
          card.innerHTML = '<span class="rsbw-card-name">' + escapeHtml(loc.name) + '</span>' + (loc.address ? '<span class="rsbw-card-sub">' + escapeHtml(loc.address) + '</span>' : '');
          card.addEventListener('click', function () {
            state.locationId = loc.id;
            state.step = presetPackage ? 3 : 2;
            render();
          });
          grid.appendChild(card);
        });
      });
    }

    // KROK 2 — Usługa
    function renderServiceStep(container) {
      renderLoading(container);
      api('services').then(function (res) {
        if (!res.success) { container.innerHTML = errorBox(res.error); return; }
        state.services = res.services;
        container.innerHTML = '<h3 class="rsbw-title">Wybierz rodzaj wizyty</h3><div class="rsbw-list"></div>' + backButton();
        var list = container.querySelector('.rsbw-list');
        state.services.forEach(function (svc) {
          var item = document.createElement('button');
          item.type = 'button';
          item.className = 'rsbw-service';
          item.innerHTML =
            '<span class="rsbw-service-dot" style="background:' + escapeHtml(svc.color || '#2563eb') + '"></span>' +
            '<span class="rsbw-service-info"><span class="rsbw-service-name">' + escapeHtml(svc.name) + '</span>' +
            '<span class="rsbw-service-meta">' + svc.duration + ' min' + (svc.price ? ' &middot; ' + svc.price + ' zł' : '') + '</span></span>' +
            '<span class="rsbw-service-arrow">&rarr;</span>';
          item.addEventListener('click', function () {
            state.serviceId = svc.id;
            state.step = 3;
            render();
          });
          list.appendChild(item);
        });
        bindBack(container, 1);
      });
    }

    // KROK 3 — Kalendarz
    function renderCalendarStep(container) {
      if (!state.services.length) {
        api('services').then(function (res) { if (res.success) state.services = res.services; drawPackageNote(); });
      }
      container.innerHTML =
        '<h3 class="rsbw-title">Wybierz dzień</h3>' +
        '<div class="rsbw-package-note"></div>' +
        '<div class="rsbw-cal">' +
        '  <div class="rsbw-cal-head">' +
        '    <button type="button" class="rsbw-cal-nav" data-dir="-1" aria-label="Poprzedni miesiąc">&larr;</button>' +
        '    <span class="rsbw-cal-month"></span>' +
        '    <button type="button" class="rsbw-cal-nav" data-dir="1" aria-label="Następny miesiąc">&rarr;</button>' +
        '  </div>' +
        '  <div class="rsbw-cal-grid"></div>' +
        '</div>' + backButton();
      bindBack(container, presetPackage ? 1 : 2);
      drawPackageNote();

      function drawPackageNote() {
        var noteEl = container.querySelector('.rsbw-package-note');
        if (!noteEl || !presetPackage) return;
        var svc = state.services.find(function (s) { return s.id === presetPackage; });
        if (svc) noteEl.innerHTML = '<div class="rsbw-pkg-note">Wybrany pakiet: <strong>' + escapeHtml(svc.name) + '</strong> &mdash; ' + svc.price + ' zł</div>';
      }

      container.querySelectorAll('.rsbw-cal-nav').forEach(function (btn) {
        btn.addEventListener('click', function () {
          state.calendarMonth.setMonth(state.calendarMonth.getMonth() + parseInt(btn.getAttribute('data-dir'), 10));
          drawCalendar();
        });
      });

      drawCalendar();

      function drawCalendar() {
        var year = state.calendarMonth.getFullYear();
        var month = state.calendarMonth.getMonth();
        var monthEl = container.querySelector('.rsbw-cal-month');
        monthEl.textContent = MONTHS_PL[month] + ' ' + year;

        var grid = container.querySelector('.rsbw-cal-grid');
        grid.innerHTML = '<div class="rsbw-loading" style="grid-column:1/-1">Ładowanie dostępnych dni&hellip;</div>';

        var q = 'location=' + encodeURIComponent(state.locationId) +
                '&service=' + encodeURIComponent(state.serviceId) +
                '&year=' + year + '&month=' + (month + 1);

        api('available-days', { query: q }).then(function (res) {
          var availSet = {};
          if (res.success && res.days) {
            res.days.forEach(function (d) { availSet[d] = true; });
          }

          grid.innerHTML = '';
          DAYS_PL.forEach(function (d) {
            var head = document.createElement('div');
            head.className = 'rsbw-cal-dow';
            head.textContent = d;
            grid.appendChild(head);
          });

          var firstDay = new Date(year, month, 1);
          var startOffset = (firstDay.getDay() + 6) % 7;
          var daysInMonth = new Date(year, month + 1, 0).getDate();
          var today = new Date();
          today.setHours(0, 0, 0, 0);

          for (var i = 0; i < startOffset; i++) {
            grid.appendChild(document.createElement('div'));
          }

          for (var day = 1; day <= daysInMonth; day++) {
            var cellDate = new Date(year, month, day);
            var iso = isoDate(cellDate);
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'rsbw-cal-day';
            btn.textContent = String(day);
            btn.setAttribute('data-iso', iso);

            if (cellDate < today || !availSet[iso]) {
              btn.disabled = true;
              btn.classList.add(cellDate < today ? 'past' : 'unavailable');
            } else {
              btn.addEventListener('click', function (ev) {
                container.querySelectorAll('.rsbw-cal-day.selected').forEach(function (el) { el.classList.remove('selected'); });
                ev.currentTarget.classList.add('selected');
                state.selectedDate = ev.currentTarget.getAttribute('data-iso');
                state.step = 4;
                render();
              });
            }
            grid.appendChild(btn);
          }
        });
      }
    }

    // KROK 4 — Godzina
    function renderTimeStep(container) {
      renderLoading(container);
      var q = 'location=' + encodeURIComponent(state.locationId) + '&service=' + encodeURIComponent(state.serviceId) + '&date=' + encodeURIComponent(state.selectedDate);
      api('slots', { query: q }).then(function (res) {
        if (!res.success) { container.innerHTML = errorBox(res.error); return; }
        state.slots = res.slots;
        container.innerHTML = '<h3 class="rsbw-title">Wybierz godzinę &mdash; ' + formatDatePl(state.selectedDate) + '</h3>';
        if (!state.slots.length) {
          container.innerHTML += '<p class="rsbw-empty">Brak wolnych terminów tego dnia. Wróć i wybierz inny dzień.</p>';
        } else {
          container.innerHTML += '<div class="rsbw-times"></div>';
          var wrap = container.querySelector('.rsbw-times');
          state.slots.forEach(function (slot) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'rsbw-time';
            btn.textContent = slot;
            btn.addEventListener('click', function () {
              state.selectedTime = slot;
              state.step = 5;
              render();
            });
            wrap.appendChild(btn);
          });
        }
        container.insertAdjacentHTML('beforeend', backButton());
        bindBack(container, 3);
      });
    }

    // KROK 5 — Formularz
    function renderFormStep(container) {
      var svc = (state.services || []).find(function (s) { return s.id === state.serviceId; });
      var needsPay = !!(svc && svc.requiresPayment);
      var submitLabel = needsPay ? 'Zarezerwuj i zapłać' : 'Potwierdź rezerwację';
      var payNote = needsPay
        ? '<div class="rsbw-paynote">Ta usługa wymaga płatności online z góry' + (svc.price ? ' (' + svc.price + ' zł)' : '') +
          '. Po kliknięciu „' + submitLabel + '" przejdziesz do bezpiecznej płatności PayU, a termin rezerwujemy po jej zaksięgowaniu.</div>'
        : '';
      container.innerHTML =
        '<h3 class="rsbw-title">Twoje dane</h3>' +
        '<form class="rsbw-form">' +
        '  <div class="rsbw-form-row"><label>Imię*<input type="text" name="firstName" required></label><label>Nazwisko*<input type="text" name="lastName" required></label></div>' +
        '  <label class="rsbw-form-full">Adres e-mail*<input type="email" name="email" required></label>' +
        '  <label class="rsbw-form-full">Telefon<input type="tel" name="phone"></label>' +
        '  <label class="rsbw-form-full">Uwagi (opcjonalnie)<textarea name="notes" rows="3"></textarea></label>' +
        '  <div class="rsbw-rodo">' +
        '    <label><input type="checkbox" name="rodo" required><span>Wyrażam zgodę na przetwarzanie moich danych osobowych przez <strong>Radosław Siałkowski</strong> w celu realizacji rezerwacji. Więcej informacji w <a href="/polityka-prywatnosci/" target="_blank">Polityce prywatności</a>.</span></label>' +
        '  </div>' +
        '  <div class="rsbw-error" style="display:none"></div>' +
        payNote +
        '  <button type="submit" class="rsbw-submit">' + submitLabel + '</button>' +
        '</form>' + backButton();
      bindBack(container, 4);

      var form = container.querySelector('.rsbw-form');
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var submitBtn = form.querySelector('.rsbw-submit');
        var errorBoxEl = form.querySelector('.rsbw-error');
        errorBoxEl.style.display = 'none';
        submitBtn.disabled = true;
        submitBtn.textContent = 'Wysyłanie…';

        var payload = {
          locationId: state.locationId,
          serviceId: state.serviceId,
          date: state.selectedDate,
          time: state.selectedTime,
          firstName: form.firstName.value.trim(),
          lastName: form.lastName.value.trim(),
          email: form.email.value.trim(),
          phone: form.phone.value.trim(),
          notes: form.notes.value.trim(),
        };

        api('book', { body: payload }).then(function (res) {
          if (!res.success) {
            errorBoxEl.textContent = res.error || 'Coś poszło nie tak. Spróbuj ponownie.';
            errorBoxEl.style.display = 'block';
            submitBtn.disabled = false;
            submitBtn.textContent = submitLabel;
            return;
          }
          if (res.payUrl) {
            submitBtn.textContent = 'Przekierowanie do płatności…';
            window.location.href = res.payUrl;
            return;
          }
          state.confirmedBooking = res.booking;
          state.step = 6;
          render();
        }).catch(function () {
          errorBoxEl.textContent = 'Błąd połączenia z serwerem. Spróbuj ponownie.';
          errorBoxEl.style.display = 'block';
          submitBtn.disabled = false;
          submitBtn.textContent = 'Potwierdź rezerwację';
        });
      });
    }

    // KROK 6 — Potwierdzenie
    function renderConfirmStep(container) {
      var loc = state.locations.find(function (l) { return l.id === state.locationId; });
      var svc = state.services.find(function (s) { return s.id === state.serviceId; });
      container.innerHTML =
        '<div class="rsbw-confirm">' +
        '  <div class="rsbw-confirm-icon">&#10003;</div>' +
        '  <h3 class="rsbw-title">Rezerwacja potwierdzona!</h3>' +
        '  <div class="rsbw-confirm-box">' +
        '    <div><strong>Usługa:</strong> ' + escapeHtml(svc ? svc.name : '') + '</div>' +
        '    <div><strong>Lokalizacja:</strong> ' + escapeHtml(loc ? loc.name : '') + '</div>' +
        '    <div><strong>Termin:</strong> ' + formatDatePl(state.selectedDate) + ', godz. ' + escapeHtml(state.selectedTime) + '</div>' +
        '  </div>' +
        '  <p class="rsbw-confirm-note">Potwierdzenie zostało wysłane na podany adres e-mail.</p>' +
        '</div>';
    }

    function backButton() {
      return '<button type="button" class="rsbw-back">&larr; Wróć</button>';
    }
    function bindBack(container, targetStep) {
      var btn = container.querySelector('.rsbw-back');
      if (btn) btn.addEventListener('click', function () { state.step = targetStep; render(); });
    }
    function errorBox(msg) {
      return '<p class="rsbw-empty" style="color:#ef4444">' + escapeHtml(msg || 'Wystąpił błąd.') + '</p>';
    }
    function escapeHtml(str) {
      var div = document.createElement('div');
      div.textContent = String(str == null ? '' : str);
      return div.innerHTML;
    }
    function isoDate(d) {
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    function formatDatePl(iso) {
      var parts = iso.split('-');
      var d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
      return d.getDate() + ' ' + MONTHS_PL[d.getMonth()].toLowerCase() + ' ' + d.getFullYear();
    }

    render();
  }

  function injectStyles() {
    if (document.getElementById('rsbw-styles')) return;
    var style = document.createElement('style');
    style.id = 'rsbw-styles';
    style.textContent = '\
.rsbw{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:680px;margin:0 auto;background:#fff;border-radius:20px;box-shadow:0 4px 24px rgba(15,23,42,.08);padding:32px;box-sizing:border-box}\
.rsbw *{box-sizing:border-box}\
.rsbw-steps{display:flex;align-items:center;margin-bottom:28px;flex-wrap:wrap;gap:4px}\
.rsbw-step{display:flex;flex-direction:column;align-items:center;gap:4px;flex:1;min-width:0}\
.rsbw-step-num{width:26px;height:26px;border-radius:50%;background:#e2e8f0;color:#64748b;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700}\
.rsbw-step.active .rsbw-step-num{background:#2563eb;color:#fff}\
.rsbw-step.done .rsbw-step-num{background:#0f172a;color:#fff}\
.rsbw-step-label{font-size:10px;color:#94a3b8;text-align:center;display:none}\
.rsbw-step.active .rsbw-step-label{color:#0f172a;font-weight:700;display:block}\
.rsbw-step-line{flex:0 0 8px;height:1px;background:#e2e8f0;margin-top:-16px}\
.rsbw-title{font-size:18px;font-weight:800;color:#0f172a;margin:0 0 18px}\
.rsbw-loading{text-align:center;padding:40px 0;color:#94a3b8;font-size:14px}\
.rsbw-empty{color:#64748b;font-size:14px;padding:16px 0}\
.rsbw-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px}\
.rsbw-card{border:2px solid #e2e8f0;border-radius:14px;padding:18px;background:#f8fafc;cursor:pointer;text-align:left;display:flex;flex-direction:column;gap:4px;transition:border-color .15s}\
.rsbw-card:hover{border-color:#2563eb;background:#eff6ff}\
.rsbw-card-name{font-weight:700;color:#0f172a;font-size:15px}\
.rsbw-card-sub{font-size:12px;color:#94a3b8}\
.rsbw-list{display:flex;flex-direction:column;gap:10px;margin-bottom:18px}\
.rsbw-service{display:flex;align-items:center;gap:12px;border:2px solid #e2e8f0;border-radius:12px;padding:14px 16px;background:#f8fafc;cursor:pointer;text-align:left;transition:border-color .15s}\
.rsbw-service:hover{border-color:#2563eb;background:#eff6ff}\
.rsbw-service-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}\
.rsbw-service-info{display:flex;flex-direction:column;flex:1;min-width:0}\
.rsbw-service-name{font-weight:700;color:#0f172a;font-size:14px}\
.rsbw-service-meta{font-size:12px;color:#94a3b8}\
.rsbw-service-arrow{color:#2563eb;font-weight:700}\
.rsbw-pkg-note{background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:10px 14px;font-size:13px;color:#1d4ed8;margin-bottom:14px}\
.rsbw-cal{margin-bottom:18px}\
.rsbw-cal-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}\
.rsbw-cal-month{font-weight:800;color:#0f172a;font-size:15px}\
.rsbw-cal-nav{width:32px;height:32px;border-radius:8px;border:1px solid #e2e8f0;background:#f8fafc;cursor:pointer;font-weight:700;color:#0f172a}\
.rsbw-cal-nav:hover{background:#eff6ff;border-color:#2563eb}\
.rsbw-cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:6px}\
.rsbw-cal-dow{text-align:center;font-size:11px;font-weight:700;color:#94a3b8;padding:6px 0}\
.rsbw-cal-day{aspect-ratio:1;border:none;border-radius:10px;background:#f8fafc;cursor:pointer;font-size:13px;font-weight:600;color:#0f172a}\
.rsbw-cal-day:hover{background:#eff6ff;color:#2563eb}\
.rsbw-cal-day.selected{background:#2563eb;color:#fff}\
.rsbw-cal-day.past{background:transparent;color:#e2e8f0;cursor:default}\
.rsbw-cal-day.unavailable{background:transparent;color:#e2e8f0;cursor:default}\
.rsbw-times{display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:10px;margin-bottom:18px}\
.rsbw-time{border:2px solid #e2e8f0;border-radius:10px;padding:10px;background:#f8fafc;cursor:pointer;font-weight:700;font-size:13px;color:#0f172a}\
.rsbw-time:hover{border-color:#2563eb;background:#eff6ff;color:#2563eb}\
.rsbw-form{display:flex;flex-direction:column;gap:14px}\
.rsbw-form-row{display:flex;gap:14px}\
.rsbw-form-row label,.rsbw-form-full{display:flex;flex-direction:column;gap:6px;font-size:13px;font-weight:600;color:#0f172a;flex:1}\
.rsbw-form input,.rsbw-form textarea{border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;font-size:14px;font-family:inherit;background:#f8fafc}\
.rsbw-form input:focus,.rsbw-form textarea:focus{outline:none;border-color:#2563eb;background:#fff}\
.rsbw-rodo{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px}\
.rsbw-rodo label{display:flex;gap:10px;align-items:flex-start;font-size:12px;color:#475569;line-height:1.5;cursor:pointer}\
.rsbw-rodo input[type=checkbox]{margin-top:2px;flex-shrink:0;width:16px;height:16px;accent-color:#2563eb}\
.rsbw-rodo a{color:#2563eb;text-decoration:underline}\
.rsbw-error{color:#ef4444;font-size:13px;font-weight:600}\
.rsbw-paynote{background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:11px 14px;font-size:12.5px;color:#9a3412;line-height:1.5;margin:2px 0 4px}\
.rsbw-submit{background:#2563eb;color:#fff;border:none;border-radius:12px;padding:15px;font-size:15px;font-weight:700;cursor:pointer;margin-top:4px}\
.rsbw-submit:hover{background:#1d4ed8}\
.rsbw-submit:disabled{opacity:.6;cursor:default}\
.rsbw-back{background:none;border:none;color:#2563eb;font-size:13px;font-weight:600;cursor:pointer;margin-top:14px;padding:0}\
.rsbw-back:hover{text-decoration:underline}\
.rsbw-confirm{text-align:center;padding:12px 0}\
.rsbw-confirm-icon{width:56px;height:56px;border-radius:50%;background:#16a34a;color:#fff;font-size:28px;display:flex;align-items:center;justify-content:center;margin:0 auto 16px}\
.rsbw-confirm-box{background:#f8fafc;border-radius:14px;padding:20px;text-align:left;display:flex;flex-direction:column;gap:8px;font-size:14px;color:#0f172a;margin:0 auto 16px;max-width:380px}\
.rsbw-confirm-note{color:#64748b;font-size:13px}\
@media(max-width:480px){.rsbw{padding:20px}.rsbw-form-row{flex-direction:column}.rsbw-step-label{display:none!important}}\
';
    document.head.appendChild(style);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
