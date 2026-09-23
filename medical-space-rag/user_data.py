"""Physiological user data helpers and seed script."""

from __future__ import annotations

from datetime import date, timedelta
from statistics import mean
from typing import Any

from database import get_connection, init_db

METRIC_LABELS = {
    "poids": ("Weight", "kg"),
    "fc_repos": ("Resting heart rate", "bpm"),
    "sommeil": ("Sleep duration", "h"),
    "temperature": ("Body temperature", "C"),
    "activite": ("Activity level", "units"),
}


def _trend_phrase(first: float, last: float, unit: str) -> str:
    delta = last - first
    sign = "+" if delta >= 0 else ""
    return f"change from first to latest: {sign}{delta:.1f} {unit}".rstrip()


def _format_metric(label: str, unit: str, values: list[float]) -> str:
    if not values:
        return f"{label}:\n- no data available"

    latest = values[-1]
    avg = mean(values)
    minimum = min(values)
    maximum = max(values)
    trend = _trend_phrase(values[0], values[-1], unit)
    unit_suffix = f" {unit}" if unit else ""
    return (
        f"{label}:\n"
        f"- latest: {latest}{unit_suffix}\n"
        f"- {len(values)}-day average: {avg:.1f}{unit_suffix}\n"
        f"- minimum: {minimum}{unit_suffix}\n"
        f"- maximum: {maximum}{unit_suffix}\n"
        f"- {trend}"
    )


def get_user_data_summary(days: int = 7) -> str:
    """
    Summarize recent physiological rows with min/max/avg/latest/trend.
    """
    init_db()
    with get_connection() as conn:
        rows = list(
            conn.execute(
                """
                SELECT date, poids, fc_repos, sommeil, temperature, activite
                FROM users_data
                ORDER BY date DESC, id DESC
                LIMIT ?
                """,
                (days,),
            )
        )

    if not rows:
        return (
            "No physiological data available in users_data for the requested window."
        )

    # Chronological order for trend (oldest -> newest)
    rows = list(reversed(rows))
    date_span = f"{rows[0]['date']} -> {rows[-1]['date']}"

    series: dict[str, list[float]] = {key: [] for key in METRIC_LABELS}
    for row in rows:
        for key in METRIC_LABELS:
            value = row[key]
            if value is not None:
                series[key].append(float(value))

    sections = [f"Window: last {days} rows ({date_span})", ""]
    for key, (label, unit) in METRIC_LABELS.items():
        sections.append(_format_metric(label, unit, series[key]))
        sections.append("")

    return "\n".join(sections).strip()


def clear_user_data() -> None:
    with get_connection() as conn:
        conn.execute("DELETE FROM users_data")


def insert_user_row(row: dict[str, Any]) -> None:
    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO users_data (date, poids, fc_repos, sommeil, temperature, activite)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                row["date"],
                row.get("poids"),
                row.get("fc_repos"),
                row.get("sommeil"),
                row.get("temperature"),
                row.get("activite"),
            ),
        )


def seed_demo_data() -> None:
    """Insert a 7-day synthetic vitals series for RAG testing (not clinical truth)."""
    init_db()
    clear_user_data()

    today = date.today()
    # Rising resting HR + reduced sleep — useful for Phase 1 test scenarios
    series = [
        {"poids": 72.0, "fc_repos": 70, "sommeil": 7.5, "temperature": 36.6, "activite": 8},
        {"poids": 72.1, "fc_repos": 72, "sommeil": 7.0, "temperature": 36.7, "activite": 7},
        {"poids": 71.9, "fc_repos": 74, "sommeil": 6.5, "temperature": 36.6, "activite": 6},
        {"poids": 71.8, "fc_repos": 76, "sommeil": 6.0, "temperature": 36.8, "activite": 5},
        {"poids": 71.7, "fc_repos": 78, "sommeil": 5.5, "temperature": 36.7, "activite": 5},
        {"poids": 71.6, "fc_repos": 80, "sommeil": 5.0, "temperature": 36.9, "activite": 4},
        {"poids": 71.5, "fc_repos": 82, "sommeil": 4.5, "temperature": 37.0, "activite": 3},
    ]

    for offset, values in enumerate(series):
        day = today - timedelta(days=len(series) - 1 - offset)
        insert_user_row({"date": day.isoformat(), **values})

    print(f"Inserted {len(series)} rows into users_data.")
    print(get_user_data_summary(days=7))


if __name__ == "__main__":
    seed_demo_data()
