"""Seeded sample datasets for Flowbench.

Each dataset is a deterministic generator: same call, same rows, every time.
Row counts are bounded for safe public-demo execution. Datasets whose id ends
in ``-faulty`` deliberately contain defects for failure-handling demos; all
others conform to their declared schema.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Callable, Iterator


@dataclass(frozen=True)
class FieldSpec:
    name: str
    type: str  # "string" | "integer" | "float" | "boolean" | "timestamp"
    description: str = ""


@dataclass(frozen=True)
class Dataset:
    id: str
    name: str
    domain: str
    description: str
    row_count: int
    schema: tuple[FieldSpec, ...]
    generator: Callable[[], Iterator[dict]] = field(compare=False)

    def rows(self) -> Iterator[dict]:
        return self.generator()

    def describe(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "domain": self.domain,
            "description": self.description,
            "row_count": self.row_count,
            "faulty": self.id.endswith("-faulty"),
            "schema": [vars(f) for f in self.schema],
        }


def _ts(base: datetime, **delta: float) -> str:
    return (base + timedelta(**delta)).isoformat() + "Z"


# ---------------------------------------------------------------------------
# IoT, finance, healthcare
# ---------------------------------------------------------------------------


def _iot_rows(n: int, faulty: bool) -> Iterator[dict]:
    """IoT sensor readings. Faulty variant injects ~8% defective rows."""
    rng = random.Random(42)
    base = datetime(2026, 1, 1)
    devices = [f"dev-{s}" for s in ("a1", "b2", "c3", "d4", "e5", "f6", "g7", "h8")]
    sites = ["plant-north", "plant-south", "warehouse-east", "warehouse-west"]
    for i in range(n):
        row: dict[str, Any] = {
            "reading_id": f"r-{i:06d}",
            "device_id": rng.choice(devices),
            "site": rng.choice(sites),
            "recorded_at": (base + timedelta(minutes=5 * i)).isoformat() + "Z",
            "temperature_c": round(rng.gauss(22.0, 4.0), 2),
            "humidity_pct": round(min(100.0, max(0.0, rng.gauss(45.0, 10.0))), 2),
            "battery_pct": round(min(100.0, max(0.0, 100.0 - i / (n / 100.0) + rng.gauss(0, 2))), 1),
        }
        if faulty:
            defect = rng.random()
            if defect < 0.02:
                row["temperature_c"] = None
            elif defect < 0.04:
                row["temperature_c"] = "hot"  # wrong type
            elif defect < 0.055:
                row["humidity_pct"] = round(rng.uniform(120, 300), 2)  # out of range
            elif defect < 0.07:
                row["device_id"] = None
            elif defect < 0.08:
                # duplicate reading_id: reuse an earlier id
                row["reading_id"] = f"r-{rng.randint(0, max(0, i - 1)):06d}"
        yield row


def _transaction_rows(n: int) -> Iterator[dict]:
    rng = random.Random(7)
    base = datetime(2026, 2, 1)
    merchants = ["Acme Corp", "Globex", "Initech", "Umbrella", "Stark Industries",
                 "Wayne Enterprises", "Hooli", "Pied Piper"]
    currencies = ["USD", "EUR", "GBP", "INR"]
    categories = ["groceries", "travel", "software", "dining", "retail", "utilities"]
    for i in range(n):
        yield {
            "txn_id": f"t-{i:06d}",
            "account_id": f"acct-{rng.randint(1000, 1250)}",
            "merchant": rng.choice(merchants),
            "category": rng.choice(categories),
            "amount": round(rng.lognormvariate(3.2, 0.9), 2),
            "currency": rng.choice(currencies),
            "occurred_at": (base + timedelta(seconds=rng.randint(0, 60 * 24 * 60 * 60))).isoformat() + "Z",
            "is_international": rng.random() < 0.18,
        }


def _vitals_rows(n: int) -> Iterator[dict]:
    rng = random.Random(99)
    base = datetime(2026, 3, 1)
    wards = ["icu", "general", "cardiology", "er"]
    for i in range(n):
        yield {
            "record_id": f"v-{i:06d}",
            "patient_id": f"pt-{rng.randint(100, 350)}",
            "ward": rng.choice(wards),
            "heart_rate": int(rng.gauss(75, 14)),
            "systolic_bp": int(rng.gauss(122, 16)),
            "spo2_pct": round(min(100.0, rng.gauss(97.5, 1.4)), 1),
            "measured_at": (base + timedelta(minutes=rng.randint(0, 30 * 24 * 60))).isoformat() + "Z",
        }


# ---------------------------------------------------------------------------
# Retail
# ---------------------------------------------------------------------------

SKUS = {
    "SKU-1001": {"product_name": "Wireless Mouse", "category": "electronics", "unit_cost": 9.5},
    "SKU-1002": {"product_name": "Mechanical Keyboard", "category": "electronics", "unit_cost": 41.0},
    "SKU-1003": {"product_name": "USB-C Hub", "category": "electronics", "unit_cost": 18.25},
    "SKU-2001": {"product_name": "Espresso Beans 1kg", "category": "grocery", "unit_cost": 11.8},
    "SKU-2002": {"product_name": "Green Tea 100ct", "category": "grocery", "unit_cost": 4.6},
    "SKU-3001": {"product_name": "Running Shoes", "category": "apparel", "unit_cost": 38.0},
    "SKU-3002": {"product_name": "Rain Jacket", "category": "apparel", "unit_cost": 29.5},
    "SKU-4001": {"product_name": "Desk Lamp", "category": "home", "unit_cost": 14.9},
    "SKU-4002": {"product_name": "Cast Iron Pan", "category": "home", "unit_cost": 21.0},
    "SKU-5001": {"product_name": "Paperback Novel", "category": "books", "unit_cost": 5.2},
}
_LIST_PRICE = {sku: round(v["unit_cost"] * 1.8, 2) for sku, v in SKUS.items()}


def _order_rows(n: int, faulty: bool) -> Iterator[dict]:
    """E-commerce order lines. Faulty variant injects ~10% defective rows."""
    rng = random.Random(1234)
    base = datetime(2026, 4, 1)
    skus = list(SKUS)
    channels = ["web", "app", "store", "marketplace"]
    countries = ["IN", "US", "GB", "DE", "SG", "AE"]
    for i in range(n):
        sku = rng.choice(skus)
        row: dict[str, Any] = {
            "order_id": f"o-{i:06d}",
            "customer_id": f"c-{rng.randint(1, 420):04d}",
            "sku": sku,
            "quantity": rng.choice((1, 1, 1, 2, 2, 3, 4, 6)),
            "unit_price": round(_LIST_PRICE[sku] * rng.uniform(0.85, 1.0), 2),
            "channel": rng.choice(channels),
            "country": rng.choice(countries),
            "ordered_at": _ts(base, minutes=rng.randint(0, 45 * 24 * 60)),
            "is_gift": rng.random() < 0.12,
        }
        if faulty:
            defect = rng.random()
            if defect < 0.025:
                row["quantity"] = rng.choice((0, -1, -2))  # impossible quantity
            elif defect < 0.045:
                row["sku"] = None
            elif defect < 0.06:
                row["sku"] = f"SKU-9{rng.randint(100, 999)}"  # not in the catalog
            elif defect < 0.075:
                row["unit_price"] = f"{row['unit_price']:.2f}".replace(".", ",")  # locale string
            elif defect < 0.09:
                row["country"] = rng.choice(("in", "USA", "Germany"))  # not ISO-2
            elif defect < 0.10:
                row["order_id"] = f"o-{rng.randint(0, max(0, i - 1)):06d}"  # duplicate
        yield row


# ---------------------------------------------------------------------------
# Web / observability
# ---------------------------------------------------------------------------


def _web_log_rows(n: int) -> Iterator[dict]:
    rng = random.Random(8080)
    base = datetime(2026, 5, 12, 9, 0, 0)
    routes = [("GET", "/"), ("GET", "/products"), ("GET", "/products/{id}"), ("POST", "/cart"),
              ("POST", "/checkout"), ("GET", "/static/app.js"), ("GET", "/api/search"),
              ("PUT", "/api/profile"), ("DELETE", "/cart/{id}"), ("GET", "/healthz")]
    agents = ["chrome", "safari", "firefox", "edge", "mobile-app", "bot"]
    regions = ["ap-south", "us-east", "eu-west"]
    for i in range(n):
        method, path = rng.choice(routes)
        path = path.replace("{id}", str(rng.randint(1, 999)))
        roll = rng.random()
        status = 200 if roll < 0.86 else 304 if roll < 0.9 else rng.choice((400, 401, 404)) if roll < 0.96 else rng.choice((500, 502, 503))
        slow = status >= 500 or path.startswith("/checkout")
        yield {
            "request_id": f"req-{i:06d}",
            "ts": _ts(base, seconds=i * 1.7),
            "method": method,
            "path": path,
            "status": status,
            "latency_ms": int(rng.lognormvariate(5.6 if slow else 4.2, 0.5)),
            "bytes": 0 if status == 304 else int(rng.lognormvariate(8.5, 1.0)),
            "user_agent": rng.choice(agents),
            "region": rng.choice(regions),
        }


# ---------------------------------------------------------------------------
# Logistics
# ---------------------------------------------------------------------------

CARRIERS = {
    "BLU": {"carrier_name": "BlueLine Freight", "mode": "road", "on_time_target_pct": 92},
    "SKY": {"carrier_name": "SkyBridge Air Cargo", "mode": "air", "on_time_target_pct": 96},
    "OCN": {"carrier_name": "Oceanic Lines", "mode": "sea", "on_time_target_pct": 85},
    "RAI": {"carrier_name": "RailConnect", "mode": "rail", "on_time_target_pct": 90},
    "SWF": {"carrier_name": "Swift Parcel", "mode": "road", "on_time_target_pct": 94},
}
_TRANSIT_DAYS = {"road": 3, "air": 1, "sea": 18, "rail": 6}


def _shipment_rows(n: int) -> Iterator[dict]:
    rng = random.Random(4242)
    base = datetime(2026, 3, 15)
    hubs = ["BOM", "DEL", "BLR", "SIN", "DXB", "RTM", "LAX", "FRA"]
    for i in range(n):
        carrier = rng.choice(list(CARRIERS))
        origin, dest = rng.sample(hubs, 2)
        eta = _TRANSIT_DAYS[CARRIERS[carrier]["mode"]] + rng.randint(0, 2)
        slip = max(0, int(rng.gauss(0.4, 1.6)))
        roll = rng.random()
        status = "in_transit" if roll < 0.15 else "returned" if roll < 0.18 else "delayed" if slip > 2 else "delivered"
        yield {
            "shipment_id": f"s-{i:06d}",
            "carrier": carrier,
            "origin_hub": origin,
            "dest_hub": dest,
            "weight_kg": round(rng.lognormvariate(2.6, 1.1), 2),
            "shipped_at": _ts(base, hours=rng.randint(0, 60 * 24)),
            "eta_days": eta,
            "transit_days": eta + slip,
            "status": status,
        }


# ---------------------------------------------------------------------------
# Climate
# ---------------------------------------------------------------------------

STATIONS = {
    "WS-MUM": {"city": "Mumbai", "elevation_m": 14, "climate_zone": "tropical"},
    "WS-DEL": {"city": "Delhi", "elevation_m": 216, "climate_zone": "semi-arid"},
    "WS-SHL": {"city": "Shimla", "elevation_m": 2276, "climate_zone": "highland"},
    "WS-LON": {"city": "London", "elevation_m": 11, "climate_zone": "oceanic"},
    "WS-OSL": {"city": "Oslo", "elevation_m": 23, "climate_zone": "continental"},
    "WS-DXB": {"city": "Dubai", "elevation_m": 5, "climate_zone": "desert"},
}
_STATION_BASE_C = {"WS-MUM": 29, "WS-DEL": 27, "WS-SHL": 12, "WS-LON": 11, "WS-OSL": 4, "WS-DXB": 33}


def _weather_rows(n: int) -> Iterator[dict]:
    rng = random.Random(2026)
    base = datetime(2026, 1, 1)
    stations = list(STATIONS)
    for i in range(n):
        st = stations[i % len(stations)]
        temp = round(rng.gauss(_STATION_BASE_C[st], 4.5), 1)
        precip = round(max(0.0, rng.gauss(-2, 6)), 1)
        cond = ("snow" if temp < 0 and precip > 0 else "storm" if precip > 12
                else "rain" if precip > 0 else rng.choice(("clear", "clear", "cloudy")))
        yield {
            "obs_id": f"w-{i:06d}",
            "station_id": st,
            "observed_at": _ts(base, hours=(i // len(stations)) * 6),
            "temp_c": temp,
            "precip_mm": precip,
            "wind_kph": round(abs(rng.gauss(14, 9)), 1),
            "pressure_hpa": round(rng.gauss(1013, 7), 1),
            "condition": cond,
        }


# ---------------------------------------------------------------------------
# Aviation
# ---------------------------------------------------------------------------

AIRPORTS = {
    "BOM": {"airport_name": "Chhatrapati Shivaji Maharaj Intl", "city": "Mumbai", "country": "IN"},
    "DEL": {"airport_name": "Indira Gandhi Intl", "city": "Delhi", "country": "IN"},
    "BLR": {"airport_name": "Kempegowda Intl", "city": "Bengaluru", "country": "IN"},
    "DXB": {"airport_name": "Dubai Intl", "city": "Dubai", "country": "AE"},
    "SIN": {"airport_name": "Changi", "city": "Singapore", "country": "SG"},
    "LHR": {"airport_name": "Heathrow", "city": "London", "country": "GB"},
    "JFK": {"airport_name": "John F. Kennedy Intl", "city": "New York", "country": "US"},
}
_COORDS = {"BOM": (19.09, 72.87), "DEL": (28.56, 77.10), "BLR": (13.20, 77.71), "DXB": (25.25, 55.36),
           "SIN": (1.36, 103.99), "LHR": (51.47, -0.45), "JFK": (40.64, -73.78)}


def _km(a: str, b: str) -> int:
    from math import asin, cos, radians, sin, sqrt
    (la1, lo1), (la2, lo2) = (map(radians, _COORDS[a]), map(radians, _COORDS[b]))
    h = sin((la2 - la1) / 2) ** 2 + cos(la1) * cos(la2) * sin((lo2 - lo1) / 2) ** 2
    return int(2 * 6371 * asin(sqrt(h)))


def _flight_rows(n: int) -> Iterator[dict]:
    rng = random.Random(737)
    base = datetime(2026, 6, 1, 5, 0)
    airlines = {"AI": "Air India", "6E": "IndiGo", "EK": "Emirates", "SQ": "Singapore Airlines", "BA": "British Airways"}
    codes = list(AIRPORTS)
    for i in range(n):
        airline = rng.choice(list(airlines))
        origin, dest = rng.sample(codes, 2)
        cancelled = rng.random() < 0.025
        delay = 0 if cancelled else int(rng.choice((-1, 1, 1, 1)) * abs(rng.gauss(0, 6)) + max(0, rng.gauss(4, 22)))
        yield {
            "flight_id": f"f-{i:06d}",
            "airline": airline,
            "flight_no": f"{airline}{rng.randint(100, 999)}",
            "origin": origin,
            "destination": dest,
            "scheduled_dep": _ts(base, minutes=i * 17),
            "dep_delay_min": delay,
            "distance_km": _km(origin, dest),
            "cancelled": cancelled,
        }


# ---------------------------------------------------------------------------
# HR
# ---------------------------------------------------------------------------


def _employee_rows(n: int) -> Iterator[dict]:
    rng = random.Random(31337)
    base = datetime(2015, 1, 1)
    depts = {"engineering": 2.0, "data": 2.1, "design": 1.6, "sales": 1.4, "support": 1.0, "finance": 1.5}
    titles = ["associate", "engineer", "senior", "lead", "manager", "director", "vp"]
    for i in range(n):
        dept = rng.choice(list(depts))
        level = min(7, max(1, int(rng.gauss(3, 1.4))))
        yield {
            "employee_id": f"e-{i:05d}",
            "department": dept,
            "title": titles[level - 1],
            "level": level,
            "salary": int(round(depts[dept] * (28_000 + level * 14_000) * rng.uniform(0.9, 1.15), -2)),
            "hired_on": _ts(base, days=rng.randint(0, 11 * 365)),
            "remote": rng.random() < 0.35,
            "rating": round(min(5.0, max(1.0, rng.gauss(3.6, 0.6))), 1),
        }


# ---------------------------------------------------------------------------
# Catalog
# ---------------------------------------------------------------------------


def _schema(*fields: tuple[str, str] | tuple[str, str, str]) -> tuple[FieldSpec, ...]:
    return tuple(FieldSpec(*f) for f in fields)


_IOT_SCHEMA = _schema(
    ("reading_id", "string", "Unique reading identifier"),
    ("device_id", "string", "Emitting device"),
    ("site", "string", "Site where the device is installed"),
    ("recorded_at", "timestamp", "UTC reading time"),
    ("temperature_c", "float", "Ambient temperature in Celsius"),
    ("humidity_pct", "float", "Relative humidity 0-100"),
    ("battery_pct", "float", "Device battery level 0-100"),
)

_ORDER_SCHEMA = _schema(
    ("order_id", "string", "Unique order line id"),
    ("customer_id", "string"),
    ("sku", "string", "Product SKU (joins to the products lookup)"),
    ("quantity", "integer", "Units ordered, at least 1"),
    ("unit_price", "float", "Price per unit after discount"),
    ("channel", "string", "web, app, store or marketplace"),
    ("country", "string", "ISO 3166-1 alpha-2 code"),
    ("ordered_at", "timestamp"),
    ("is_gift", "boolean"),
)

_DATASETS: tuple[Dataset, ...] = (
    Dataset("iot-sensors", "IoT Sensor Readings", "iot",
            "2,000 seeded temperature/humidity readings from 8 devices across 4 sites.",
            2000, _IOT_SCHEMA, lambda: _iot_rows(2000, faulty=False)),
    Dataset("iot-sensors-faulty", "IoT Sensor Readings (faulty)", "iot",
            "Same 2,000 seeded readings with ~8% injected defects: null temperatures, "
            "wrong types, out-of-range humidity, missing device IDs, and duplicate "
            "reading IDs. Use it to demo validation failures and replay.",
            2000, _IOT_SCHEMA, lambda: _iot_rows(2000, faulty=True)),
    Dataset("transactions", "Banking Transactions", "finance",
            "1,500 seeded card transactions across ~250 accounts and 8 merchants.",
            1500, _schema(
                ("txn_id", "string", "Unique transaction identifier"),
                ("account_id", "string"),
                ("merchant", "string", "Merchant name (joins to the merchants lookup)"),
                ("category", "string"),
                ("amount", "float", "Transaction amount"),
                ("currency", "string", "ISO currency code"),
                ("occurred_at", "timestamp"),
                ("is_international", "boolean"),
            ), lambda: _transaction_rows(1500)),
    Dataset("vitals", "Patient Vitals", "healthcare",
            "1,200 seeded vitals records across ~250 patients and 4 wards.",
            1200, _schema(
                ("record_id", "string", "Unique record identifier"),
                ("patient_id", "string"),
                ("ward", "string", "Ward code (joins to the wards lookup)"),
                ("heart_rate", "integer", "Beats per minute"),
                ("systolic_bp", "integer", "mmHg"),
                ("spo2_pct", "float", "Oxygen saturation 0-100"),
                ("measured_at", "timestamp"),
            ), lambda: _vitals_rows(1200)),
    Dataset("orders", "E-commerce Orders", "retail",
            "1,800 seeded order lines across 10 products, 4 sales channels and 6 countries.",
            1800, _ORDER_SCHEMA, lambda: _order_rows(1800, faulty=False)),
    Dataset("orders-faulty", "E-commerce Orders (faulty)", "retail",
            "Same 1,800 order lines with ~10% injected defects: zero or negative quantities, "
            "missing and unknown SKUs, locale-formatted prices, non-ISO country codes, and "
            "duplicate order IDs.",
            1800, _ORDER_SCHEMA, lambda: _order_rows(1800, faulty=True)),
    Dataset("web-logs", "Web Access Logs", "observability",
            "2,000 seeded HTTP requests with realistic status mixes (2xx/3xx/4xx/5xx), "
            "latency skew on checkout and errors, and bot traffic.",
            2000, _schema(
                ("request_id", "string"),
                ("ts", "timestamp", "Request time (UTC)"),
                ("method", "string", "HTTP method"),
                ("path", "string", "Request path"),
                ("status", "integer", "HTTP status code"),
                ("latency_ms", "integer", "Server latency in milliseconds"),
                ("bytes", "integer", "Response size"),
                ("user_agent", "string", "Client family"),
                ("region", "string", "Serving region"),
            ), lambda: _web_log_rows(2000)),
    Dataset("shipments", "Freight Shipments", "logistics",
            "1,400 seeded shipments across 5 carriers (road, air, sea, rail) and 8 hubs, "
            "with planned vs. actual transit days.",
            1400, _schema(
                ("shipment_id", "string"),
                ("carrier", "string", "Carrier code (joins to the carriers lookup)"),
                ("origin_hub", "string"),
                ("dest_hub", "string"),
                ("weight_kg", "float"),
                ("shipped_at", "timestamp"),
                ("eta_days", "integer", "Planned transit days"),
                ("transit_days", "integer", "Actual transit days"),
                ("status", "string", "in_transit, delivered, delayed or returned"),
            ), lambda: _shipment_rows(1400)),
    Dataset("weather", "Weather Observations", "climate",
            "1,620 seeded 6-hourly observations from 6 stations in different climate zones.",
            1620, _schema(
                ("obs_id", "string"),
                ("station_id", "string", "Station (joins to the stations lookup)"),
                ("observed_at", "timestamp"),
                ("temp_c", "float", "Air temperature in Celsius"),
                ("precip_mm", "float", "Precipitation over the period"),
                ("wind_kph", "float"),
                ("pressure_hpa", "float"),
                ("condition", "string", "clear, cloudy, rain, storm or snow"),
            ), lambda: _weather_rows(1620)),
    Dataset("flights", "Flight Departures", "aviation",
            "1,500 seeded departures for 5 airlines between 7 airports, with delays, "
            "great-circle distances, and cancellations.",
            1500, _schema(
                ("flight_id", "string"),
                ("airline", "string", "IATA airline code"),
                ("flight_no", "string"),
                ("origin", "string", "IATA airport code (joins to the airports lookup)"),
                ("destination", "string", "IATA airport code"),
                ("scheduled_dep", "timestamp"),
                ("dep_delay_min", "integer", "Departure delay; negative means early"),
                ("distance_km", "integer"),
                ("cancelled", "boolean"),
            ), lambda: _flight_rows(1500)),
    Dataset("employees", "Employee Directory", "hr",
            "900 seeded employees across 6 departments with levels, salaries, tenure and ratings.",
            900, _schema(
                ("employee_id", "string"),
                ("department", "string"),
                ("title", "string"),
                ("level", "integer", "Career level 1-7"),
                ("salary", "integer", "Annual salary"),
                ("hired_on", "timestamp"),
                ("remote", "boolean"),
                ("rating", "float", "Performance rating 1.0-5.0"),
            ), lambda: _employee_rows(900)),
)

DATASETS: dict[str, Dataset] = {d.id: d for d in _DATASETS}


def get_dataset(dataset_id: str) -> Dataset | None:
    return DATASETS.get(dataset_id)


def list_datasets() -> list[dict]:
    return [d.describe() for d in DATASETS.values()]


# Static dimension tables for the join_lookup transform.
LOOKUPS: dict[str, dict[str, dict[str, Any]]] = {
    "devices": {
        "dev-a1": {"model": "sense-100", "firmware": "2.1.0", "commissioned": "2024-03-11"},
        "dev-b2": {"model": "sense-100", "firmware": "2.1.4", "commissioned": "2024-03-15"},
        "dev-c3": {"model": "sense-200", "firmware": "3.0.1", "commissioned": "2024-06-02"},
        "dev-d4": {"model": "sense-200", "firmware": "3.0.1", "commissioned": "2024-06-02"},
        "dev-e5": {"model": "sense-300", "firmware": "3.2.0", "commissioned": "2025-01-20"},
        "dev-f6": {"model": "sense-300", "firmware": "3.2.0", "commissioned": "2025-01-20"},
        "dev-g7": {"model": "sense-100", "firmware": "1.9.8", "commissioned": "2023-11-30"},
        "dev-h8": {"model": "sense-300", "firmware": "3.1.2", "commissioned": "2025-02-14"},
    },
    "merchants": {
        "Acme Corp": {"industry": "industrial", "risk_tier": "low"},
        "Globex": {"industry": "industrial", "risk_tier": "medium"},
        "Initech": {"industry": "software", "risk_tier": "low"},
        "Umbrella": {"industry": "pharma", "risk_tier": "high"},
        "Stark Industries": {"industry": "defense", "risk_tier": "medium"},
        "Wayne Enterprises": {"industry": "conglomerate", "risk_tier": "low"},
        "Hooli": {"industry": "software", "risk_tier": "medium"},
        "Pied Piper": {"industry": "software", "risk_tier": "low"},
    },
    "wards": {
        "icu": {"ward_name": "Intensive Care", "capacity": 24},
        "general": {"ward_name": "General Medicine", "capacity": 120},
        "cardiology": {"ward_name": "Cardiology", "capacity": 40},
        "er": {"ward_name": "Emergency", "capacity": 36},
    },
    "products": SKUS,
    "carriers": CARRIERS,
    "stations": STATIONS,
    "airports": AIRPORTS,
}


def list_lookups() -> list[dict]:
    return [
        {"name": name, "keys": len(table),
         "fields": sorted(next(iter(table.values())).keys()) if table else []}
        for name, table in LOOKUPS.items()
    ]
