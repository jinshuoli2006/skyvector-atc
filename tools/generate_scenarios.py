#!/usr/bin/env python3
"""Generate static ATC scenarios for SkyVector ATC.

This script is intentionally deterministic by default so GitHub Pages can host
prebuilt JSON data. Run it locally whenever you want fresh traffic sets:

    python tools/generate_scenarios.py --count 5 --seed 20260521
"""
from __future__ import annotations

import argparse
import json
import math
import random
from pathlib import Path

AIRLINES = ["CPA", "CES", "CSN", "CCA", "CDG", "HKE", "JYH", "DKH", "APG", "SIA", "UAE", "QTR"]
TYPES = ["A320", "A321", "B738", "B39M", "A359", "B789", "E190", "C919"]
GATES = {
    "NORTH": {"x": 0.00, "y": 0.93, "bearing": 0, "label": "北门"},
    "EAST": {"x": 0.93, "y": 0.00, "bearing": 90, "label": "东门"},
    "SOUTH": {"x": 0.00, "y": -0.93, "bearing": 180, "label": "南门"},
    "WEST": {"x": -0.93, "y": 0.00, "bearing": 270, "label": "西门"},
}
FIXES = [
    {"id": "ALPHA", "x": -0.48, "y": 0.52, "label": "ALPHA"},
    {"id": "BRAVO", "x": 0.42, "y": 0.58, "label": "BRAVO"},
    {"id": "CANTO", "x": 0.55, "y": -0.35, "label": "CANTO"},
    {"id": "DELTA", "x": -0.55, "y": -0.42, "label": "DELTA"},
    {"id": "FINAL04", "x": -0.28, "y": -0.34, "label": "F04"},
    {"id": "FINAL22", "x": 0.28, "y": 0.34, "label": "F22"},
]
RUNWAYS = [
    {"id": "RWY 04", "heading": 40, "x": 0.0, "y": 0.0, "length": 0.46},
    {"id": "RWY 22", "heading": 220, "x": 0.0, "y": 0.0, "length": 0.46},
]


def callsign(rng: random.Random, used: set[str]) -> str:
    while True:
        c = f"{rng.choice(AIRLINES)}{rng.randint(100, 989)}"
        if c not in used:
            used.add(c)
            return c


def reciprocal_heading_to_center(gate: str) -> int:
    return (GATES[gate]["bearing"] + 180) % 360


def weather_cells(rng: random.Random, count: int) -> list[dict]:
    cells = []
    for idx in range(count):
        angle = rng.uniform(0, math.tau)
        radius = rng.uniform(0.18, 0.72)
        cells.append({
            "id": f"WX{idx+1}",
            "x": round(math.sin(angle) * radius, 3),
            "y": round(math.cos(angle) * radius, 3),
            "r": round(rng.uniform(0.08, 0.16), 3),
            "severity": rng.choice(["light", "moderate", "heavy"]),
        })
    return cells


def make_scenario(
    rng: random.Random,
    index: int,
    difficulty: int,
    base_arrivals: int,
    base_departures: int,
    arrival_step: int,
    departure_step: int,
    spacing_multiplier: float,
) -> dict:
    used: set[str] = set()
    traffic: list[dict] = []
    name_pool = ["晨间进近", "海湾离场", "雷雨绕飞", "夜航高峰", "训练扇区", "繁忙终端区"]
    arrival_count = base_arrivals + difficulty * arrival_step
    departure_count = base_departures + difficulty * departure_step
    arrival_gates = list(GATES.keys())
    departure_exits = list(GATES.keys())

    for i in range(arrival_count):
        gate = rng.choice(arrival_gates)
        runway = rng.choice(RUNWAYS)
        spawn_t = round((8 + i * rng.randint(38, 58) + rng.randint(0, 12)) * spacing_multiplier)
        traffic.append({
            "id": f"A{index}{i}",
            "callsign": callsign(rng, used),
            "kind": "arrival",
            "type": rng.choice(TYPES),
            "spawnAt": spawn_t,
            "spawnGate": gate,
            "x": GATES[gate]["x"],
            "y": GATES[gate]["y"],
            "heading": reciprocal_heading_to_center(gate),
            "altitude": rng.choice([6000, 7000, 8000, 9000]),
            "speed": rng.choice([220, 240, 250, 260]),
            "targetRunway": runway["id"],
            "targetAltitude": 1800,
        })

    for i in range(departure_count):
        exit_gate = rng.choice(departure_exits)
        runway = rng.choice(RUNWAYS)
        queue_t = round((i * rng.randint(30, 48) + rng.randint(0, 10)) * spacing_multiplier)
        traffic.append({
            "id": f"D{index}{i}",
            "callsign": callsign(rng, used),
            "kind": "departure",
            "type": rng.choice(TYPES),
            "queueAt": queue_t,
            "spawnAt": queue_t,
            "status": "queued",
            "targetExit": exit_gate,
            "runway": runway["id"],
            "heading": runway["heading"],
            "altitude": 0,
            "speed": 0,
            "targetAltitude": rng.choice([5000, 6000, 7000]),
        })

    traffic.sort(key=lambda item: item.get("spawnAt", 0))
    return {
        "id": f"scenario-{index}",
        "name": f"{name_pool[(index - 1) % len(name_pool)]} · Level {difficulty}",
        "difficulty": difficulty,
        "airspace": {
            "name": "珠江终端管制区",
            "radiusNm": 42,
            "minSeparationNm": max(4.2, 5.5 - difficulty * 0.35),
            "handoffToleranceDeg": 28,
            "groundHoldLimitSec": max(90, 140 - difficulty * 8),
            "gates": [{"id": k, **v} for k, v in GATES.items()],
            "fixes": FIXES,
            "runways": RUNWAYS,
            "weather": weather_cells(rng, max(1, difficulty)),
        },
        "traffic": traffic,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate ATC simulator scenarios.")
    parser.add_argument("--count", type=int, default=4, help="number of scenarios")
    parser.add_argument("--seed", type=int, default=20260521, help="random seed")
    parser.add_argument("--output", type=Path, default=Path("data/scenarios.json"), help="output JSON path")
    parser.add_argument("--base-arrivals", type=int, default=2, help="arrival count before difficulty scaling")
    parser.add_argument("--base-departures", type=int, default=1, help="departure count before difficulty scaling")
    parser.add_argument("--arrival-step", type=int, default=1, help="extra arrivals per difficulty level")
    parser.add_argument("--departure-step", type=int, default=1, help="extra departures per difficulty level")
    parser.add_argument("--spacing-multiplier", type=float, default=1.0, help="multiply spawn/queue times; larger means calmer traffic")
    args = parser.parse_args()

    rng = random.Random(args.seed)
    scenarios = [
        make_scenario(
            rng,
            i + 1,
            min(5, 1 + i),
            args.base_arrivals,
            args.base_departures,
            args.arrival_step,
            args.departure_step,
            args.spacing_multiplier,
        )
        for i in range(args.count)
    ]
    payload = {"version": 1, "generatedBy": "tools/generate_scenarios.py", "scenarios": scenarios}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {len(scenarios)} scenarios to {args.output}")


if __name__ == "__main__":
    main()
