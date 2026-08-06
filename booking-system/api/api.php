<?php
/**
 * System Rezerwacji — Przyjazny Dietetyk
 * Backend API (pliki JSON, bez bazy danych)
 *
 * Endpointy publiczne (dla widgetu):
 *   GET  api.php?action=locations
 *   GET  api.php?action=services
 *   GET  api.php?action=slots&location=torun&service=konsultacja-pierwsza&date=2026-07-01
 *   POST api.php?action=book   (JSON body: locationId, serviceId, date, time, firstName, lastName, email, phone, notes)
 *
 * Endpointy admina (wymagają nagłówka X-Api-Key):
 *   GET    api.php?action=bookings
 *   POST   api.php?action=add-service     (JSON: id, name, duration, price, color)
 *   POST   api.php?action=delete-service  (JSON: id)
 *   POST   api.php?action=update-location (JSON: id, hours, address, name)
 *   POST   api.php?action=add-block       (JSON: locationId, date, allDay, start, end, reason)
 *   POST   api.php?action=delete-block    (JSON: index)
 *   POST   api.php?action=cancel-booking  (JSON: id)
 */

error_reporting(E_ALL);
ini_set('display_errors', '0');

header('Content-Type: application/json; charset=utf-8');

// --- CORS: zezwól na wywołania z dietetyktorun.pl (dopasuj domenę jeśli inna) ---
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Api-Key');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

define('DATA_DIR', __DIR__ . '/data');

function rs_read_json($file) {
    $path = DATA_DIR . '/' . $file;
    if (!file_exists($path)) return [];
    $fp = fopen($path, 'r');
    flock($fp, LOCK_SH);
    $content = stream_get_contents($fp);
    flock($fp, LOCK_UN);
    fclose($fp);
    $data = json_decode($content, true);
    return is_array($data) ? $data : [];
}

function rs_write_json($file, $data) {
    $path = DATA_DIR . '/' . $file;
    $fp = fopen($path, 'c');
    flock($fp, LOCK_EX);
    ftruncate($fp, 0);
    rewind($fp);
    fwrite($fp, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    fflush($fp);
    flock($fp, LOCK_UN);
    fclose($fp);
}

function rs_config() {
    static $cfg = null;
    if ($cfg === null) $cfg = rs_read_json('config.json');
    return $cfg;
}

function rs_require_admin() {
    $cfg = rs_config();
    $key = $_SERVER['HTTP_X_API_KEY'] ?? '';
    if (!$key || !isset($cfg['apiKey']) || !hash_equals($cfg['apiKey'], $key)) {
        rs_error('Brak autoryzacji', 401);
    }
}

function rs_error($message, $code = 400) {
    http_response_code($code);
    echo json_encode(['success' => false, 'error' => $message], JSON_UNESCAPED_UNICODE);
    exit;
}

function rs_ok($data = []) {
    echo json_encode(array_merge(['success' => true], $data), JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    exit;
}

function rs_body() {
    $raw = file_get_contents('php://input');
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

// ── PayU: bramka płatności ─────────────────────────────────────────────
function rs_payu_cfg() {
    $p = rs_config()['payu'] ?? [];
    $p['base'] = !empty($p['sandbox']) ? 'https://secure.snd.payu.com' : 'https://secure.payu.com';
    return $p;
}
function rs_payu_enabled() {
    $p = rs_payu_cfg();
    return !empty($p['enabled']) && !empty($p['posId']) && !empty($p['clientId'])
        && !empty($p['clientSecret']) && !empty($p['secondKey']) && function_exists('curl_init');
}
function rs_http($method, $url, $headers, $body = null) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST  => $method,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_FOLLOWLOCATION => false,   // PayU zwraca redirectUri w ciele odpowiedzi (302) — nie podążamy
        CURLOPT_TIMEOUT        => 20,
    ]);
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $redir = curl_getinfo($ch, CURLINFO_REDIRECT_URL);
    $err = curl_error($ch);
    curl_close($ch);
    return ['code' => $code, 'body' => $resp, 'redirect' => $redir, 'err' => $err];
}
function rs_payu_token() {
    $p = rs_payu_cfg();
    $r = rs_http('POST', $p['base'] . '/pl/standard/user/oauth/authorize',
        [
            'Content-Type: application/x-www-form-urlencoded',
            'Accept: application/json',
            'User-Agent: Mozilla/5.0 (compatible; RSBookingWidget/1.0)',
        ],
        http_build_query([
            'grant_type'    => 'client_credentials',
            'client_id'     => $p['clientId'],
            'client_secret' => $p['clientSecret'],
        ]));
    $j = json_decode($r['body'], true);
    return $j['access_token'] ?? null;
}
// Tworzy zamówienie PayU — 1:1 jak oryginalna wtyczka WordPress (extOrderId = id rezerwacji)
function rs_payu_create_order($booking, $location, $service, $token) {
    $p    = rs_payu_cfg();
    $cfg  = rs_config();
    $base = rtrim($cfg['baseUrl'] ?? '', '/');
    $amount = (int) round(((float) ($service['price'] ?? 0)) * 100); // grosze
    $order = [
        'notifyUrl'     => $base . '/wp-json/rs/v1/api?action=payu-notify',
        'continueUrl'   => $base . '/rezerwacja-potwierdzenie/?bookingId=' . rawurlencode($booking['id']),
        'customerIp'    => $_SERVER['REMOTE_ADDR'] ?? '127.0.0.1',
        'merchantPosId' => (string) $p['posId'],
        'description'   => $service['name'] . ' — ' . $location['name'],
        'currencyCode'  => $p['currency'] ?? 'PLN',
        'totalAmount'   => (string) $amount,
        'extOrderId'    => $booking['id'],
        'buyer' => [
            'email'     => $booking['email'],
            'phone'     => $booking['phone'],
            'firstName' => $booking['firstName'],
            'lastName'  => $booking['lastName'],
            'language'  => 'pl',
        ],
        'products' => [[
            'name'      => $service['name'],
            'unitPrice' => (string) $amount,
            'quantity'  => '1',
        ]],
    ];
    $r = rs_http('POST', $p['base'] . '/api/v2_1/orders',
        [
            'Content-Type: application/json',
            'Accept: application/json',
            'Authorization: Bearer ' . $token,
            'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        ],
        json_encode($order, JSON_UNESCAPED_UNICODE));
    $j = json_decode($r['body'], true);
    // PayU zwykle odpowiada 302 z nagłówkiem Location; czasem 200/201 z redirectUri w ciele
    $redirect = (in_array($r['code'], [301, 302, 303], true) && !empty($r['redirect']))
        ? $r['redirect']
        : ($j['redirectUri'] ?? ($r['redirect'] ?: null));
    return [
        'orderId'     => $j['orderId'] ?? null,
        'redirectUri' => $redirect,
        'status'      => $j['status']['statusCode'] ?? null,
    ];
}
function rs_payu_verify_signature($rawBody) {
    $header = $_SERVER['HTTP_OPENPAYU_SIGNATURE'] ?? ($_SERVER['HTTP_X_OPENPAYU_SIGNATURE'] ?? '');
    if (!$header) return false;
    $incoming = ''; $algo = 'MD5';
    foreach (explode(';', $header) as $part) {
        $kv = explode('=', trim($part), 2);
        if (count($kv) !== 2) continue;
        if ($kv[0] === 'signature') $incoming = $kv[1];
        if ($kv[0] === 'algorithm') $algo = strtoupper($kv[1]);
    }
    if (!$incoming) return false;
    $secondKey = rs_payu_cfg()['secondKey'] ?? '';
    $expected = ($algo === 'SHA-256' || $algo === 'SHA256')
        ? hash('sha256', $rawBody . $secondKey)
        : md5($rawBody . $secondKey);
    return hash_equals($expected, $incoming);
}

$action = $_GET['action'] ?? '';

// Dni tygodnia PHP date('N') -> 1=Mon..7=Sun, mapujemy na klucze w locations.json
$dayKeys = [1 => 'mon', 2 => 'tue', 3 => 'wed', 4 => 'thu', 5 => 'fri', 6 => 'sat', 7 => 'sun'];

switch ($action) {

    case 'locations':
        rs_ok(['locations' => rs_read_json('locations.json')]);
        break;

    case 'services':
        rs_ok(['services' => rs_read_json('services.json')]);
        break;

    case 'available-days':
        $locationId = $_GET['location'] ?? '';
        $serviceId  = $_GET['service'] ?? '';
        $year       = (int) ($_GET['year'] ?? date('Y'));
        $month      = (int) ($_GET['month'] ?? date('m'));

        if (!$locationId || !$serviceId) rs_error('Brak wymaganych parametrów (location, service)');

        $locations = rs_read_json('locations.json');
        $services  = rs_read_json('services.json');
        $location  = null;
        foreach ($locations as $l) { if ($l['id'] === $locationId) { $location = $l; break; } }
        $service = null;
        foreach ($services as $s) { if ($s['id'] === $serviceId) { $service = $s; break; } }
        if (!$location) rs_error('Nieznana lokalizacja', 404);
        if (!$service) rs_error('Nieznana usługa', 404);

        $duration   = (int) ($service['duration'] ?? 60);
        $slotStep   = 30;
        $blocks     = rs_read_json('blocks.json');
        $bookings   = rs_read_json('bookings.json');
        $daysInMonth = (int) date('t', mktime(0, 0, 0, $month, 1, $year));
        $today      = mktime(0, 0, 0, (int)date('m'), (int)date('d'), (int)date('Y'));
        $now        = time();
        $availableDays = [];

        for ($day = 1; $day <= $daysInMonth; $day++) {
            $ts = mktime(0, 0, 0, $month, $day, $year);
            if ($ts < $today) continue;
            $date   = date('Y-m-d', $ts);
            $dayKey = $dayKeys[(int) date('N', $ts)];
            $ranges = $location['hours'][$dayKey] ?? [];
            if (empty($ranges)) continue;

            // Sprawdź blokadę całodniową
            $allDayBlocked = false;
            foreach ($blocks as $b) {
                if ($b['locationId'] === $locationId && $b['date'] === $date && !empty($b['allDay'])) {
                    $allDayBlocked = true; break;
                }
            }
            if ($allDayBlocked) continue;

            // Generuj sloty
            $slots = [];
            foreach ($ranges as $range) {
                $start = strtotime($date . ' ' . $range[0]);
                $end   = strtotime($date . ' ' . $range[1]);
                for ($t = $start; $t + $duration * 60 <= $end; $t += $slotStep * 60) {
                    $slots[] = date('H:i', $t);
                }
            }

            // Wyklucz zajęte i blokady godzinowe
            $taken = [];
            foreach ($bookings as $b) {
                if ($b['locationId'] === $locationId && $b['date'] === $date && rs_holds_slot($b)) {
                    $taken[] = $b['time'];
                }
            }
            $hourBlocks = [];
            foreach ($blocks as $b) {
                if ($b['locationId'] === $locationId && $b['date'] === $date && empty($b['allDay']) && !empty($b['start'])) {
                    $hourBlocks[] = [$b['start'], $b['end'] ?? $b['start']];
                }
            }

            $hasFree = false;
            foreach ($slots as $slot) {
                $slotTs = strtotime($date . ' ' . $slot);
                if ($slotTs <= $now) continue;
                if (in_array($slot, $taken, true)) continue;
                $blocked = false;
                foreach ($hourBlocks as $hb) {
                    if ($slot >= $hb[0] && $slot < $hb[1]) { $blocked = true; break; }
                }
                if (!$blocked) { $hasFree = true; break; }
            }
            if ($hasFree) $availableDays[] = $date;
        }

        rs_ok(['days' => $availableDays]);
        break;

    case 'slots':
        $locationId = $_GET['location'] ?? '';
        $serviceId  = $_GET['service'] ?? '';
        $date       = $_GET['date'] ?? '';

        if (!$locationId || !$serviceId || !$date) rs_error('Brak wymaganych parametrów (location, service, date)');
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) rs_error('Nieprawidłowy format daty (RRRR-MM-DD)');

        $locations = rs_read_json('locations.json');
        $services  = rs_read_json('services.json');
        $location  = null;
        foreach ($locations as $l) { if ($l['id'] === $locationId) { $location = $l; break; } }
        $service = null;
        foreach ($services as $s) { if ($s['id'] === $serviceId) { $service = $s; break; } }
        if (!$location) rs_error('Nieznana lokalizacja', 404);
        if (!$service) rs_error('Nieznana usługa', 404);

        $ts = strtotime($date);
        if ($ts === false) rs_error('Nieprawidłowa data');
        $dayKey = $dayKeys[(int) date('N', $ts)];
        $ranges = $location['hours'][$dayKey] ?? [];

        // Sprawdź całodniowe blokady
        $blocks = rs_read_json('blocks.json');
        foreach ($blocks as $b) {
            if ($b['locationId'] === $locationId && $b['date'] === $date && !empty($b['allDay'])) {
                rs_ok(['slots' => []]);
            }
        }

        $duration = (int) ($service['duration'] ?? 60);
        $slotStep = 30; // siatka slotów co 30 minut
        $slots = [];

        foreach ($ranges as $range) {
            $start = strtotime($date . ' ' . $range[0]);
            $end   = strtotime($date . ' ' . $range[1]);
            for ($t = $start; $t + $duration * 60 <= $end; $t += $slotStep * 60) {
                $slots[] = date('H:i', $t);
            }
        }

        // Wyklucz sloty kolidujące z istniejącymi rezerwacjami
        $bookings = rs_read_json('bookings.json');
        $taken = [];
        foreach ($bookings as $b) {
            if ($b['locationId'] === $locationId && $b['date'] === $date && rs_holds_slot($b)) {
                $taken[] = $b['time'];
            }
        }

        // Wyklucz sloty kolidujące z blokadami godzinowymi
        $hourBlocks = [];
        foreach ($blocks as $b) {
            if ($b['locationId'] === $locationId && $b['date'] === $date && empty($b['allDay']) && !empty($b['start'])) {
                $hourBlocks[] = [$b['start'], $b['end'] ?? $b['start']];
            }
        }

        $now = time();
        $freeSlots = [];
        foreach ($slots as $slot) {
            $slotTs = strtotime($date . ' ' . $slot);
            if ($slotTs <= $now) continue; // nie pokazuj slotów z przeszłości
            if (in_array($slot, $taken, true)) continue;
            $blocked = false;
            foreach ($hourBlocks as $hb) {
                if ($slot >= $hb[0] && $slot < $hb[1]) { $blocked = true; break; }
            }
            if ($blocked) continue;
            $freeSlots[] = $slot;
        }

        rs_ok(['slots' => $freeSlots]);
        break;

    case 'book':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') rs_error('Metoda niedozwolona', 405);
        $body = rs_body();

        $required = ['locationId', 'serviceId', 'date', 'time', 'firstName', 'lastName', 'email'];
        foreach ($required as $field) {
            if (empty($body[$field])) rs_error("Brak pola: $field");
        }
        if (!filter_var($body['email'], FILTER_VALIDATE_EMAIL)) rs_error('Nieprawidłowy adres e-mail');

        $locations = rs_read_json('locations.json');
        $services  = rs_read_json('services.json');
        $location  = null;
        foreach ($locations as $l) { if ($l['id'] === $body['locationId']) { $location = $l; break; } }
        $service = null;
        foreach ($services as $s) { if ($s['id'] === $body['serviceId']) { $service = $s; break; } }
        if (!$location) rs_error('Nieznana lokalizacja', 404);
        if (!$service) rs_error('Nieznana usługa', 404);

        // Blokada pliku na czas odczyt-modyfikacja-zapis, żeby uniknąć podwójnej rezerwacji tego samego slotu
        $lockFile = DATA_DIR . '/bookings.lock';
        $lockFp = fopen($lockFile, 'c');
        flock($lockFp, LOCK_EX);

        $bookings = rs_read_json('bookings.json');
        foreach ($bookings as $b) {
            if ($b['locationId'] === $body['locationId'] && $b['date'] === $body['date'] && $b['time'] === $body['time'] && rs_holds_slot($b)) {
                flock($lockFp, LOCK_UN);
                fclose($lockFp);
                rs_error('Ten termin został już zarezerwowany przez kogoś innego. Wybierz inny.', 409);
            }
        }

        $requiresPayment = !empty($service['requiresPayment']);
        $usePayU = $requiresPayment && rs_payu_enabled();

        // 1:1 jak oryginał: status pending_payment + expiresAt (30 min), extOrderId = id rezerwacji
        $booking = [
            'id'         => uniqid('bk_', true),
            'locationId' => $body['locationId'],
            'serviceId'  => $body['serviceId'],
            'date'       => $body['date'],
            'time'       => $body['time'],
            'firstName'  => sanitize_text($body['firstName']),
            'lastName'   => sanitize_text($body['lastName']),
            'email'      => sanitize_text($body['email']),
            'phone'      => sanitize_text($body['phone'] ?? ''),
            'notes'      => sanitize_text($body['notes'] ?? ''),
            'price'      => $service['price'] ?? 0,
            'status'     => $usePayU ? 'pending_payment' : 'confirmed',
            'expiresAt'  => $usePayU ? date('c', time() + 30 * 60) : null,
            'createdAt'  => date('c'),
        ];

        $bookings[] = $booking;
        rs_write_json('bookings.json', $bookings);

        flock($lockFp, LOCK_UN);
        fclose($lockFp);

        // Usługa płatna z góry → utwórz płatność PayU i przekieruj (maile dopiero po zaksięgowaniu przez payu-notify)
        if ($usePayU) {
            $token = rs_payu_token();
            if (!$token) rs_error('Błąd płatności: brak tokenu autoryzacji PayU.', 500);
            $ord = rs_payu_create_order($booking, $location, $service, $token);
            if (empty($ord['redirectUri'])) rs_error('Błąd płatności: nie udało się utworzyć zamówienia PayU.', 500);
            if (!empty($ord['orderId'])) rs_booking_field($booking['id'], 'payuOrderId', $ord['orderId']);
            rs_ok(['booking' => $booking, 'payUrl' => $ord['redirectUri']]);
        }

        rs_send_booking_emails($booking, $location, $service);

        rs_ok(['booking' => $booking]);
        break;

    case 'bookings':
        rs_require_admin();
        $bookings = rs_read_json('bookings.json');
        usort($bookings, function ($a, $b) {
            return strcmp($a['date'] . $a['time'], $b['date'] . $b['time']);
        });
        rs_ok(['bookings' => $bookings]);
        break;

    case 'cancel-booking':
        rs_require_admin();
        $body = rs_body();
        if (empty($body['id'])) rs_error('Brak ID rezerwacji');
        $bookings = rs_read_json('bookings.json');
        $found = false;
        foreach ($bookings as &$b) {
            if ($b['id'] === $body['id']) { $b['status'] = 'cancelled'; $found = true; break; }
        }
        if (!$found) rs_error('Nie znaleziono rezerwacji', 404);
        rs_write_json('bookings.json', $bookings);
        rs_ok();
        break;

    case 'add-service':
        rs_require_admin();
        $body = rs_body();
        foreach (['id', 'name', 'duration'] as $f) { if (empty($body[$f]) && $body[$f] !== 0) rs_error("Brak pola: $f"); }
        $services = rs_read_json('services.json');
        foreach ($services as $s) { if ($s['id'] === $body['id']) rs_error('Usługa z tym ID już istnieje'); }
        $services[] = [
            'id' => sanitize_text($body['id']),
            'name' => sanitize_text($body['name']),
            'duration' => (int) $body['duration'],
            'price' => (float) ($body['price'] ?? 0),
            'color' => sanitize_text($body['color'] ?? '#2563eb'),
        ];
        rs_write_json('services.json', $services);
        rs_ok(['services' => $services]);
        break;

    case 'delete-service':
        rs_require_admin();
        $body = rs_body();
        if (empty($body['id'])) rs_error('Brak ID');
        $services = rs_read_json('services.json');
        $services = array_values(array_filter($services, function ($s) use ($body) { return $s['id'] !== $body['id']; }));
        rs_write_json('services.json', $services);
        rs_ok(['services' => $services]);
        break;

    case 'update-location':
        rs_require_admin();
        $body = rs_body();
        if (empty($body['id'])) rs_error('Brak ID lokalizacji');
        $locations = rs_read_json('locations.json');
        $found = false;
        foreach ($locations as &$l) {
            if ($l['id'] === $body['id']) {
                if (isset($body['name'])) $l['name'] = sanitize_text($body['name']);
                if (isset($body['address'])) $l['address'] = sanitize_text($body['address']);
                if (isset($body['hours']) && is_array($body['hours'])) $l['hours'] = $body['hours'];
                $found = true;
                break;
            }
        }
        if (!$found) rs_error('Nie znaleziono lokalizacji', 404);
        rs_write_json('locations.json', $locations);
        rs_ok(['locations' => $locations]);
        break;

    case 'add-block':
        rs_require_admin();
        $body = rs_body();
        foreach (['locationId', 'date'] as $f) { if (empty($body[$f])) rs_error("Brak pola: $f"); }
        $blocks = rs_read_json('blocks.json');
        $blocks[] = [
            'locationId' => sanitize_text($body['locationId']),
            'date'       => sanitize_text($body['date']),
            'allDay'     => !empty($body['allDay']),
            'start'      => sanitize_text($body['start'] ?? ''),
            'end'        => sanitize_text($body['end'] ?? ''),
            'reason'     => sanitize_text($body['reason'] ?? ''),
        ];
        rs_write_json('blocks.json', $blocks);
        rs_ok(['blocks' => $blocks]);
        break;

    case 'delete-block':
        rs_require_admin();
        $body = rs_body();
        if (!isset($body['index'])) rs_error('Brak indeksu');
        $blocks = rs_read_json('blocks.json');
        $idx = (int) $body['index'];
        if (!isset($blocks[$idx])) rs_error('Nie znaleziono blokady', 404);
        array_splice($blocks, $idx, 1);
        rs_write_json('blocks.json', $blocks);
        rs_ok(['blocks' => $blocks]);
        break;

    case 'blocks':
        rs_require_admin();
        rs_ok(['blocks' => rs_read_json('blocks.json')]);
        break;

    // ── Wyjątki w grafiku (nietypowe godziny / dni wolne dla konkretnej daty) ──
    case 'exceptions':
        rs_require_admin();
        rs_ok(['exceptions' => rs_read_json('exceptions.json')]);
        break;

    case 'add-exception':
        rs_require_admin();
        $body = rs_body();
        foreach (['locationId', 'date'] as $f) { if (empty($body[$f])) rs_error("Brak pola: $f"); }
        $exceptions = rs_read_json('exceptions.json');
        $exceptions[] = [
            'id'         => uniqid('exc_', true),
            'locationId' => sanitize_text($body['locationId']),
            'date'       => sanitize_text($body['date']),
            'hours'      => (isset($body['hours']) && is_array($body['hours'])) ? $body['hours'] : [],
            'reason'     => sanitize_text($body['reason'] ?? ''),
        ];
        rs_write_json('exceptions.json', $exceptions);
        rs_ok(['exceptions' => $exceptions]);
        break;

    case 'delete-exception':
        rs_require_admin();
        $body = rs_body();
        if (empty($body['id'])) rs_error('Brak ID');
        $exceptions = array_values(array_filter(rs_read_json('exceptions.json'), function ($e) use ($body) {
            return ($e['id'] ?? '') !== $body['id'];
        }));
        rs_write_json('exceptions.json', $exceptions);
        rs_ok(['exceptions' => $exceptions]);
        break;

    // ── Push: klucz publiczny VAPID (pusty = powiadomienia nieaktywne, dopóki nie skonfigurowane) ──
    case 'vapid-key':
        rs_require_admin();
        rs_ok(['key' => rs_config()['vapidPublicKey'] ?? '']);
        break;

    case 'save-subscription':
        rs_require_admin();
        $body = rs_body();
        if (empty($body['endpoint'])) rs_error('Brak endpoint');
        $subs = rs_read_json('push_subscriptions.json');
        $subs = array_values(array_filter($subs, function ($s) use ($body) { return ($s['endpoint'] ?? '') !== $body['endpoint']; }));
        $subs[] = [
            'endpoint'  => $body['endpoint'],
            'p256dh'    => $body['p256dh'] ?? '',
            'auth'      => $body['auth'] ?? '',
            'createdAt' => date('c'),
        ];
        rs_write_json('push_subscriptions.json', $subs);
        rs_ok();
        break;

    // ── Backup danych rezerwacji (ZIP; fallback JSON gdy brak ZipArchive). Bez config.json (sekrety). ──
    case 'backup':
        rs_require_admin();
        $files = ['bookings.json', 'blocks.json', 'services.json', 'locations.json', 'exceptions.json'];
        $stamp = date('Y-m-d');
        if (class_exists('ZipArchive')) {
            $tmp = tempnam(sys_get_temp_dir(), 'rsbak');
            $zip = new ZipArchive();
            $zip->open($tmp, ZipArchive::OVERWRITE);
            foreach ($files as $f) { $p = DATA_DIR . '/' . $f; if (file_exists($p)) $zip->addFile($p, $f); }
            $zip->close();
            header('Content-Type: application/zip');
            header('Content-Disposition: attachment; filename="backup-rezerwacje-' . $stamp . '.zip"');
            readfile($tmp);
            unlink($tmp);
            exit;
        }
        $bundle = [];
        foreach ($files as $f) { $bundle[$f] = rs_read_json($f); }
        header('Content-Type: application/json; charset=utf-8');
        header('Content-Disposition: attachment; filename="backup-rezerwacje-' . $stamp . '.json"');
        echo json_encode($bundle, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
        exit;

    // ── PayU webhook (powiadomienie serwer-serwer o statusie płatności) ──
    case 'payu-notify':
        $raw = file_get_contents('php://input');
        if (!rs_payu_verify_signature($raw)) {
            http_response_code(400);
            echo json_encode(['error' => 'Nieprawidłowy podpis']);
            exit;
        }
        $data  = json_decode($raw, true);
        $order = $data['order'] ?? null;
        if (!$order || empty($order['extOrderId'])) { http_response_code(200); echo 'OK'; exit; }

        $bkId   = $order['extOrderId']; // = id rezerwacji (jak w oryginale)
        $status = $order['status'] ?? '';
        $booking = null;
        foreach (rs_read_json('bookings.json') as $b) { if (($b['id'] ?? '') === $bkId) { $booking = $b; break; } }

        if ($booking && ($booking['status'] ?? '') !== 'confirmed') {
            if ($status === 'COMPLETED') {
                $updated = rs_booking_update($bkId, ['status' => 'confirmed', 'paidAt' => date('c')]);
                // Maile dopiero po zaksięgowaniu płatności
                $locations = rs_read_json('locations.json');
                $services  = rs_read_json('services.json');
                $loc = null; foreach ($locations as $l) { if ($l['id'] === $updated['locationId']) { $loc = $l; break; } }
                $svc = null; foreach ($services as $s) { if ($s['id'] === $updated['serviceId']) { $svc = $s; break; } }
                if ($loc && $svc) rs_send_booking_emails($updated, $loc, $svc);
            } elseif (in_array($status, ['CANCELED', 'CANCELLED'], true)) {
                rs_booking_update($bkId, ['status' => 'cancelled']);
            }
            // PENDING / WAITING_FOR_CONFIRMATION → czekamy na kolejne powiadomienie
        }

        // PayU wymaga odpowiedzi HTTP 200, inaczej ponawia powiadomienie
        http_response_code(200);
        echo 'OK';
        exit;

    // ── Status płatności dla strony potwierdzenia (powrót z PayU: ?bookingId=) ──
    case 'payment-status':
        $bkId = $_GET['bookingId'] ?? ($_GET['order'] ?? '');
        if (!$bkId) rs_error('Brak identyfikatora rezerwacji');
        $booking = null;
        foreach (rs_read_json('bookings.json') as $b) { if (($b['id'] ?? '') === $bkId) { $booking = $b; break; } }
        if (!$booking) rs_error('Nie znaleziono rezerwacji', 404);
        rs_ok([
            'status' => $booking['status'] ?? '',
            'date'   => $booking['date'] ?? '',
            'time'   => $booking['time'] ?? '',
        ]);
        break;

    default:
        rs_error('Nieznana akcja', 404);
}

function sanitize_text($value) {
    return trim(strip_tags((string) $value));
}

// Czy rezerwacja zajmuje slot? Potwierdzona = tak; oczekująca na płatność = tak, dopóki nie wygaśnie
function rs_holds_slot($b) {
    $status = $b['status'] ?? '';
    if ($status === 'cancelled') return false;
    if ($status === 'pending_payment' || $status === 'pending') {
        // trzyma termin do expiresAt; brak expiresAt → 30 min od utworzenia (porzucona płatność zwalnia termin)
        $deadline = !empty($b['expiresAt']) ? strtotime($b['expiresAt']) : (strtotime($b['createdAt'] ?? 'now') + 1800);
        return time() < $deadline;
    }
    return true; // confirmed i inne
}

// Ustaw status jednej rezerwacji (pod blokadą pliku)
function rs_booking_status($id, $status) {
    return rs_booking_update($id, ['status' => $status]);
}
function rs_booking_field($id, $key, $value) {
    return rs_booking_update($id, [$key => $value]);
}
function rs_booking_update($id, $fields) {
    $lockFp = fopen(DATA_DIR . '/bookings.lock', 'c');
    flock($lockFp, LOCK_EX);
    $bookings = rs_read_json('bookings.json');
    $updated = null;
    foreach ($bookings as &$b) {
        if (($b['id'] ?? '') === $id) {
            foreach ($fields as $k => $v) $b[$k] = $v;
            $updated = $b;
            break;
        }
    }
    unset($b);
    if ($updated !== null) rs_write_json('bookings.json', $bookings);
    flock($lockFp, LOCK_UN);
    fclose($lockFp);
    return $updated;
}
function rs_find_booking_by_ext($extOrderId) {
    foreach (rs_read_json('bookings.json') as $b) {
        if (($b['extOrderId'] ?? '') === $extOrderId) return $b;
    }
    return null;
}

function rs_send_booking_emails($booking, $location, $service) {
    $cfg = rs_config();
    $dateFormatted = date('d.m.Y', strtotime($booking['date']));

    $adminSubject = "Nowa rezerwacja: {$booking['firstName']} {$booking['lastName']} — {$dateFormatted} {$booking['time']}";
    $adminBody = "Nowa rezerwacja w systemie Przyjazny Dietetyk:\n\n"
        . "Pacjent: {$booking['firstName']} {$booking['lastName']}\n"
        . "E-mail: {$booking['email']}\n"
        . "Telefon: {$booking['phone']}\n"
        . "Usługa: {$service['name']}\n"
        . "Lokalizacja: {$location['name']}\n"
        . "Termin: {$dateFormatted}, godz. {$booking['time']}\n"
        . "Uwagi: {$booking['notes']}\n";

    $headers = "From: {$cfg['siteName']} <{$cfg['fromEmail']}>\r\nContent-Type: text/plain; charset=UTF-8";

    @mail($cfg['adminEmail'], $adminSubject, $adminBody, $headers);

    $patientSubject = "Potwierdzenie rezerwacji — {$cfg['siteName']}";
    $patientBody = "Dzień dobry {$booking['firstName']},\n\n"
        . "Twoja rezerwacja została potwierdzona:\n\n"
        . "Usługa: {$service['name']}\n"
        . "Lokalizacja: {$location['name']}\n"
        . "Termin: {$dateFormatted}, godz. {$booking['time']}\n\n"
        . "Do zobaczenia!\n"
        . "{$cfg['siteName']}";

    @mail($booking['email'], $patientSubject, $patientBody, $headers);
}
