import json

from backend.app.data.clob_ws import parse_market_message


def test_parse_book_message() -> None:
    books = parse_market_message(
        json.dumps({"asset_id": "yes", "bids": [{"price": "0.49", "size": "100"}], "asks": [["0.51", "80"]]})
    )

    assert len(books) == 1
    assert books[0].best_bid == 0.49
    assert books[0].best_ask == 0.51


def test_parse_best_bid_ask_message() -> None:
    books = parse_market_message(json.dumps({"asset_id": "yes", "best_bid": "0.48", "best_ask": "0.52"}))

    assert books[0].best_bid == 0.48
    assert books[0].best_ask == 0.52
