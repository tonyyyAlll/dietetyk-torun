# dietetyktorun.pl

Statyczna strona gabinetu **mgr Radosława Siałkowskiego** — dietetyka klinicznego i sportowego
z Torunia (Szosa Chełmińska 166), z własnym systemem rezerwacji wizyt w PHP.

Serwis powstał z migracji z WordPressa na czyste pliki — bez CMS-a, bez bazy danych.

## Co jest w repozytorium

| Ścieżka | Zawartość |
|---|---|
| `*.html` | 33 strony (główna, usługi, pakiety, cennik, kontakt, blog, leksykon, przepisy, strony prawne, 404) |
| `styles.css` | całość stylów serwisu (jeden plik, wersjonowany `?v=` w linkach) |
| `reveal.js` | animacje wejścia sekcji, liczniki, menu mobilne, taśma opinii |
| `img/` | zdjęcia, certyfikaty, ikony |
| `booking-system/` | system rezerwacji: API PHP, panel administracyjny, widżet |
| `.htaccess` | czyste adresy URL, przekierowania 301 ze starych adresów WordPressa |
| `sitemap.xml`, `robots.txt`, `llms.txt` | pliki dla wyszukiwarek i botów AI |

## Wymagania

- Hosting z **PHP** (Apache z obsługą `.htaccess`) — potrzebny wyłącznie dla systemu rezerwacji.
- Same strony są statyczne i zadziałają na dowolnym serwerze WWW.

## Wdrożenie

1. Skopiuj zawartość repozytorium do katalogu głównego domeny (np. `public_html`).
   Pamiętaj o plikach ukrytych — `.htaccess` jest wymagany do działania adresów URL.
2. Utwórz plik konfiguracyjny systemu rezerwacji:

   ```bash
   cp booking-system/api/data/config.example.json booking-system/api/data/config.json
   ```

3. Uzupełnij w nim własne dane (klucz API panelu, dane merchanta PayU).
4. Nadaj prawa zapisu katalogowi `booking-system/api/data/`.

## Konfiguracja i dane — poza repozytorium

Świadomie **nie są** wersjonowane (patrz `.gitignore`):

- `booking-system/api/data/config.json` — zawiera klucze produkcyjne PayU i klucz panelu,
- `booking-system/api/data/bookings.json` oraz `push_subscriptions.json` — dane osobowe pacjentów.

Katalog `data/` jest dodatkowo chroniony własnym `.htaccess` (`Require all denied`),
więc pliki z danymi nie są dostępne z przeglądarki.

## Treści medyczne

Materiały na stronie mają charakter informacyjny i edukacyjny. Dietetyk nie leczy chorób —
dietoterapia wspiera leczenie prowadzone przez lekarza i nie zastępuje konsultacji lekarskiej
ani farmakoterapii.
