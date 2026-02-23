# Altos de Márquez — Navegación GPS

Sistema de navegación vehicular para el barrio cerrado Altos de Márquez.
Muestra el mapa SVG del barrio con ruteo inteligente que respeta sentidos de circulación,
restricciones de giro y calles de mano única.

## Estructura del proyecto

```
├── index.html              Página principal
├── mapa_altos.svg          Mapa SVG del barrio (fuente de verdad)
├── css/
│   └── styles.css          Estilos dark mode tipo Uber
├── js/
│   ├── svgLoader.js        Carga del SVG y normalización de namespaces
│   ├── graphBuilder.js     Parseo de #streets → grafo dirigido
│   ├── router.js           A* con restricciones de giro
│   ├── gps.js              Tracking GPS + proyección lat/lon → SVG
│   ├── renderer.js         Dibuja ruta, markers GPS, overlays
│   ├── ui.js               Paneles, selectores, pan/zoom
│   ├── debug.js            Auditoría de rutas y diagnósticos
│   └── app.js              Orquestador principal
├── data/
│   └── pois.json           Puntos de interés (schema + datos)
└── README.md
```

## Uso rápido

1. Servir con cualquier servidor estático:
   ```bash
   python3 -m http.server 8000
   # o
   npx serve .
   ```
2. Abrir `http://localhost:8000` en el navegador.
3. Seleccionar origen (GPS, Márquez, Florida o manzana) y destino.
4. Presionar **Navegar**.

## Configuración

### Snap Tolerance (empalme de calles)

En `js/graphBuilder.js`, la variable `SNAP_TOLERANCE` (default: `2` px SVG) controla
qué tan cerca deben estar dos endpoints de segmento para considerarse el mismo nodo.

- Para aumentar: `GraphBuilder.setSnapTolerance(3);`
- Para consultar: `GraphBuilder.getSnapTolerance();`

Si calles que deberían estar conectadas no lo están, aumentar el valor.
Si calles que NO deberían conectarse se unen, reducirlo.

### Calibración GPS

En `js/gps.js`, las coordenadas de los dos puntos ancla (`anchors.a` y `anchors.b`)
mapean coordenadas GPS reales a coordenadas SVG. Ajustar con coordenadas reales:

```js
GPS.setAnchors(
  { lat: -34.4813, lon: -58.5267, svgX: 410.4, svgY: 589.8 },  // Márquez
  { lat: -34.4765, lon: -58.5220, svgX: 470.2, svgY: 52.6 }    // Florida
);
```

### Umbral de desvío

En `js/app.js`, `REROUTE_THRESHOLD` (default: `15` SVG units) define cuánto
puede alejarse el usuario de la ruta antes de recalcular.

## Cómo agregar nuevas calles al SVG

1. Abrir `mapa_altos.svg` en un editor (Illustrator, Inkscape).
2. Dentro del grupo `<g id="streets">`, agregar un nuevo `<path>`:
   ```xml
   <path id="st_XXXX" class="st43" d="M100,200 L150,200"
         data-oneway="0" data-flow="both" data-dir="both" />
   ```
3. Atributos obligatorios:
   - `id`: único, formato `st_XXXX`
   - `data-oneway`: `"0"` (doble mano) o `"1"` (mano única)
   - `data-flow`: `"in"` | `"out"` | `"both"`
   - `data-dir`: `"forward"` (A→B) | `"backward"` (B→A) | `"both"`
4. Clases de color:
   - `st43` = bidireccional (sin color)
   - `st44` / `st42` = verde (ingreso)
   - `st45` / `st41` = rojo (egreso)
   - `st46` = naranja (restricción de giro)
   - `st47` = azul (restricción de giro)
5. Recargar la app; el grafo se reconstruye automáticamente.

## Cómo agregar POIs

Editar `data/pois.json`. Cada POI sigue este schema:

```json
{
  "id": "poi_XXX",
  "name": "Nombre del lugar",
  "category": "comercio",
  "manzana": "50",
  "casa": "12",
  "xy": null,
  "hours": "Lun-Vie 9-18",
  "phone": "+541100000000",
  "whatsapp": "+5491100000000",
  "tags": ["tag1", "tag2"],
  "notes": "Información adicional",
  "links": ["https://example.com"]
}
```

Categorías válidas: `comercio`, `servicio`, `salud`, `educacion`, `recreacion`, `otro`.

## Reglas de circulación

| Color   | Clase  | Significado                               |
|---------|--------|-------------------------------------------|
| Verde   | st44   | Ingreso desde Av. Márquez                 |
| Rojo    | st45   | Egreso hacia Av. Márquez                  |
| Naranja | st46   | Restricción de giro (bloquea IN)          |
| Azul    | st47   | Restricción de giro (bloquea OUT)         |
| Sin     | st43   | Bidireccional (calles internas)           |

### Restricciones especiales

- **st_0068** (naranja): Cerca de Márquez/Manzana 29 — quienes ingresan NO pueden girar aquí.
- **st_0225** (naranja): Entrada Florida — quienes ingresan DEBEN girar (no seguir recto).
- **st_0069** (azul): Cerca de Manzana 20 — quienes egresan NO pueden girar aquí.

## Herramienta de debug

Presionar el botón ⚙ en la barra superior para abrir el panel de auditoría:

- **Auditar 200 rutas**: genera 200 pares origen-destino aleatorios y verifica que no haya contramanos ni rutas inválidas.
- **Mostrar grafo**: dibuja todos los nodos y aristas del grafo sobre el mapa.

## Tecnología

- HTML5 + CSS3 + JavaScript vanilla (ES5+)
- SVG inline para el mapa
- Sin dependencias externas ni frameworks
- Compatible con hosting estático (GitHub Pages, Netlify, etc.)
