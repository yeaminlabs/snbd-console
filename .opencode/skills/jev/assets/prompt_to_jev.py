"""Small calling example; requires the existing jev-skill package, not a new CLI."""
import argparse
import json
from pathlib import Path

import jev


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--provider', choices=('openrouter', 'typesafe'), default='openrouter')
    args = parser.parse_args(argv)
    request = jev.validate_request(jev.read_json(Path(__file__).with_name('prompt-to-jev.json')))
    if args.provider == 'typesafe' and request['model'] == jev.DEFAULT_MODEL:
        request['model'] = jev.TYPESAFE_MODEL
    if args.dry_run:
        print(json.dumps(request, indent=2))
        return 0
    response = jev.request_decisions(request, provider=args.provider)
    report = jev.build_report(request, response)
    # Authored fixture values, not facts inferred by Jev. Validate real input first.
    amount, age_days = 120, 45
    refund = report['decisions']['refund']
    needs_review = any(d['status'] == 'needs_review' for d in report['decisions'].values())
    queue = 'human_review' if needs_review else (
        'refund_review' if refund['value'] and amount > 100 and age_days > 30 else 'normal')
    print(json.dumps({'proposed_queue': queue, 'report': report}, indent=2))
    return 2 if needs_review else 0


if __name__ == '__main__':
    raise SystemExit(main())
