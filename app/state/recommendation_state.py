"""
Recommendation engine state.

Tracks which tickets have cached recommendations, which are currently
being processed, and whether the auto-recommend toggle is active.
"""

import threading

from app.config import RECOMMENDATION_MAX_WORKERS
from app.logic.ticket_advice import get_ticket_advice
from app.state import validation_cache
from services.output import Output
from app.config import DEBUG

_lock = threading.Lock()
_cache: dict = {}              # ticket_id -> full recommendation dict
_toggle: bool = False          # whether auto-recommend is active
_processing: set = set()       # ticket_ids currently being processed
_errors: set = set()           # ticket_ids that errored during processing
_stop_event = threading.Event()  # signal to stop processing new tickets


# ── Public accessors ──────────────────────────────────────────────────────────

def is_active() -> bool:
    with _lock:
        return _toggle


def set_active(active: bool) -> None:
    global _toggle
    with _lock:
        _toggle = active


def get_cache() -> dict:
    with _lock:
        return dict(_cache)


def get_cached_count() -> int:
    with _lock:
        return len(_cache)


def get_processing_list() -> list[str]:
    with _lock:
        return list(_processing)


def get_error_count() -> int:
    with _lock:
        return len(_errors)


def clear_errors() -> None:
    with _lock:
        _errors.clear()


def purge_tickets(ticket_ids: list[str]) -> None:
    """Remove tickets from cache, processing set, and errors set."""
    with _lock:
        for tid in ticket_ids:
            _cache.pop(tid, None)
            _processing.discard(tid)
            _errors.discard(tid)


def signal_stop() -> None:
    """Signal processing threads to stop submitting new work."""
    _stop_event.set()


def clear_stop() -> None:
    """Clear the stop signal so new processing can begin."""
    _stop_event.clear()


# ── Single-ticket processing ─────────────────────────────────────────────────

def process_single(ticket_id: str) -> None:
    """
    Process a single ticket recommendation via the LLM pipeline and broadcast
    the result to all connected clients.

    Thread-safe: checks cache and processing set under the lock before
    starting work.  Skips silently if already cached or in-progress.
    Respects the stop event.
    """
    output = Output()

    if _stop_event.is_set():
        return

    with _lock:
        if ticket_id in _cache:
            return
        if ticket_id in _processing:
            return
        _processing.add(ticket_id)
        _errors.discard(ticket_id)

    try:
        # Broadcast start
        validation_cache.broadcast('recommendation-start', {
            'ticket_id': ticket_id,
        }, buffer=False)

        if DEBUG:
            output.add_line(f'process_single: starting {ticket_id}')

        result = get_ticket_advice(ticket_id)

        if result and 'error' not in result:
            with _lock:
                _cache[ticket_id] = result

            validation_cache.broadcast('recommendation-complete', {
                'ticket_id': ticket_id,
                'data': result,
            }, buffer=False)

            if DEBUG:
                output.add_line(f'process_single: completed {ticket_id}')
        else:
            error_msg = (
                result.get('error', 'Unknown error') if result
                else 'No result returned'
            )
            with _lock:
                _errors.add(ticket_id)

            validation_cache.broadcast('recommendation-error', {
                'ticket_id': ticket_id,
                'error': error_msg,
            }, buffer=False)

            if DEBUG:
                output.add_line(f'process_single: error for {ticket_id}: {error_msg}')

    except Exception as exc:
        with _lock:
            _errors.add(ticket_id)

        validation_cache.broadcast('recommendation-error', {
            'ticket_id': ticket_id,
            'error': str(exc),
        }, buffer=False)

        if DEBUG:
            output.add_line(f'process_single: exception for {ticket_id}: {exc}')

    finally:
        with _lock:
            _processing.discard(ticket_id)

        # Broadcast progress (count both cached and errored as "completed")
        with _lock:
            completed = len(_cache) + len(_errors)
        total = validation_cache.get_ticket_count()

        validation_cache.broadcast('recommendation-progress', {
            'completed': completed,
            'total': total,
        }, buffer=False)


# ── Batch processing ─────────────────────────────────────────────────────────

def process_batch(ticket_ids: list[str]) -> None:
    """
    Background thread entry point: process recommendations for the given
    ticket IDs using a ThreadPoolExecutor with controlled concurrency.

    Stops submitting new work when the stop event is set, but allows
    in-flight requests to complete.
    """
    import concurrent.futures

    output = Output()
    if DEBUG:
        output.add_line(f'process_batch: starting for {len(ticket_ids)} tickets')

    executor = concurrent.futures.ThreadPoolExecutor(
        max_workers=RECOMMENDATION_MAX_WORKERS
    )
    futures = {}

    try:
        for tid in ticket_ids:
            if _stop_event.is_set():
                if DEBUG:
                    output.add_line('process_batch: stop event set, halting submissions')
                break
            with _lock:
                if tid in _cache or tid in _processing:
                    continue
            future = executor.submit(process_single, tid)
            futures[future] = tid

        for future in concurrent.futures.as_completed(futures, timeout=600):
            try:
                future.result()
            except Exception as exc:
                tid = futures[future]
                if DEBUG:
                    output.add_line(f'process_batch: future error for {tid}: {exc}')

    except concurrent.futures.TimeoutError:
        if DEBUG:
            output.add_line('process_batch: total timeout exceeded')

    finally:
        executor.shutdown(wait=False)
        if DEBUG:
            output.add_line('process_batch: finished')


def queue_for_tickets(ticket_ids: list[str]) -> list[str]:
    """
    Start a background thread to process recommendations for tickets that
    are not already cached or in-progress.

    Returns the list of ticket IDs that were actually queued.
    """
    with _lock:
        ids_to_process = [
            tid for tid in ticket_ids
            if tid not in _cache and tid not in _processing
        ]

    if ids_to_process:
        clear_stop()
        threading.Thread(
            target=process_batch,
            args=(ids_to_process,),
            daemon=True,
        ).start()

    return ids_to_process