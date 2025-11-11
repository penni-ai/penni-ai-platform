"""Unit tests for QueryExpansionService."""
from __future__ import annotations

import json
import unittest
from unittest.mock import MagicMock, Mock, patch

from functions.runtime.services.query_expansion import QueryExpansionError, QueryExpansionService


class TestQueryExpansionService(unittest.TestCase):
    """Validate QueryExpansionService behavior and error handling."""

    def _configure_settings(self, mock_settings: MagicMock, value: str = "sk-test") -> None:
        secret = Mock()
        secret.get_secret_value.return_value = value
        mock_settings.OPENAI_API_KEY = secret

    @patch("functions.runtime.services.query_expansion.settings")
    def test_init_with_api_key(self, mock_settings: MagicMock) -> None:
        self._configure_settings(mock_settings, "sk-live")
        service = QueryExpansionService()
        self.assertEqual(service.api_key, "sk-live")
        self.assertEqual(service.model, "gpt-5-mini")
        self.assertEqual(service.num_queries, 5)

    @patch("functions.runtime.services.query_expansion.settings")
    def test_init_without_api_key_raises_error(self, mock_settings: MagicMock) -> None:
        mock_settings.OPENAI_API_KEY = None
        with self.assertRaises(QueryExpansionError):
            QueryExpansionService()

    @patch.object(QueryExpansionService, "_call_openai")
    @patch("functions.runtime.services.query_expansion.settings")
    def test_generate_queries_success(self, mock_settings: MagicMock, mock_call: MagicMock) -> None:
        self._configure_settings(mock_settings)
        mock_call.return_value = json.dumps(["query1", "query2", "query3"])
        service = QueryExpansionService()
        result = service.generate_queries("SF restaurant")
        self.assertEqual(result, ["query1", "query2", "query3"])
        mock_call.assert_called_once()

    @patch.object(QueryExpansionService, "_call_openai")
    @patch("functions.runtime.services.query_expansion.settings")
    def test_generate_queries_parses_fenced_json(self, mock_settings: MagicMock, mock_call: MagicMock) -> None:
        self._configure_settings(mock_settings)
        mock_call.return_value = "```json\n[\"query1\", \"query2\", \"query3\"]\n```"
        service = QueryExpansionService()
        result = service.generate_queries("SF restaurant")
        self.assertEqual(result, ["query1", "query2", "query3"])
        mock_call.assert_called_once()

    @patch.object(QueryExpansionService, "_call_openai")
    @patch("functions.runtime.services.query_expansion.settings")
    def test_generate_queries_extracts_json_from_noise(self, mock_settings: MagicMock, mock_call: MagicMock) -> None:
        self._configure_settings(mock_settings)
        mock_call.return_value = "Here you go!\n[\"q1\", \"q2\", \"q3\"]\nThanks"
        service = QueryExpansionService()
        result = service.generate_queries("fitness studio")
        self.assertEqual(result, ["q1", "q2", "q3"])
        mock_call.assert_called_once()

    @patch.object(QueryExpansionService, "_call_openai")
    @patch("functions.runtime.services.query_expansion.settings")
    def test_generate_queries_with_invalid_json_retries_and_falls_back(
        self, mock_settings: MagicMock, mock_call: MagicMock
    ) -> None:
        self._configure_settings(mock_settings)
        mock_call.return_value = "not valid json"
        service = QueryExpansionService()
        result = service.generate_queries("fitness coach")
        self.assertEqual(result, ["fitness coach"])
        self.assertEqual(mock_call.call_count, 3)

    @patch.object(QueryExpansionService, "_call_openai")
    @patch("functions.runtime.services.query_expansion.settings")
    def test_generate_queries_with_non_list_response_falls_back(
        self, mock_settings: MagicMock, mock_call: MagicMock
    ) -> None:
        self._configure_settings(mock_settings)
        mock_call.return_value = json.dumps({"queries": ["q1"]})
        service = QueryExpansionService()
        result = service.generate_queries("beauty")
        self.assertEqual(result, ["beauty"])

    @patch("functions.runtime.services.query_expansion.settings")
    def test_generate_queries_with_empty_inquiry_raises_error(self, mock_settings: MagicMock) -> None:
        self._configure_settings(mock_settings)
        service = QueryExpansionService()
        with self.assertRaises(ValueError):
            service.generate_queries("")
        with self.assertRaises(ValueError):
            service.generate_queries("   ")

    @patch("functions.runtime.services.query_expansion.logger")
    @patch.object(QueryExpansionService, "_call_openai")
    @patch("functions.runtime.services.query_expansion.settings")
    def test_generate_queries_openai_exception_falls_back(
        self,
        mock_settings: MagicMock,
        mock_call: MagicMock,
        mock_logger: MagicMock,
    ) -> None:
        self._configure_settings(mock_settings)
        mock_call.side_effect = QueryExpansionError("boom")
        service = QueryExpansionService()
        result = service.generate_queries("tech startup")
        self.assertEqual(result, ["tech startup"])
        self.assertGreaterEqual(mock_logger.warning.call_count, 1)

    @patch("functions.runtime.services.query_expansion.settings")
    def test_build_prompt_includes_business_inquiry(self, mock_settings: MagicMock) -> None:
        self._configure_settings(mock_settings)
        service = QueryExpansionService()
        prompt = service._build_prompt("SF foodie restaurant")
        self.assertIn("SF foodie restaurant", prompt)
        self.assertIn("JSON array", prompt)
        self.assertIn("diverse", prompt.lower())

    @patch.object(QueryExpansionService, "_call_openai")
    @patch("functions.runtime.services.query_expansion.settings")
    def test_custom_num_queries_parameter(self, mock_settings: MagicMock, mock_call: MagicMock) -> None:
        self._configure_settings(mock_settings)
        captured_prompt = {}

        def fake_call(prompt: str) -> str:
            captured_prompt["value"] = prompt
            return json.dumps(["a", "b", "c"])

        mock_call.side_effect = fake_call
        service = QueryExpansionService(num_queries=3)
        result = service.generate_queries("wellness brand")
        self.assertEqual(result, ["a", "b", "c"])
        self.assertIn("Generate 3", captured_prompt.get("value", ""))

    @patch.object(QueryExpansionService, "_call_openai")
    @patch("functions.runtime.services.query_expansion.settings")
    def test_generate_queries_caps_results_to_requested_count(
        self, mock_settings: MagicMock, mock_call: MagicMock
    ) -> None:
        self._configure_settings(mock_settings)
        mock_call.return_value = json.dumps(["q1", "q2", "q3", "q4", "q5"])
        service = QueryExpansionService(num_queries=3)
        result = service.generate_queries("eco brand")
        self.assertEqual(result, ["q1", "q2", "q3"])
        mock_call.assert_called_once()

    @patch.object(QueryExpansionService, "_call_openai")
    @patch("functions.runtime.services.query_expansion.settings")
    def test_generate_queries_deduplicates_queries(self, mock_settings: MagicMock, mock_call: MagicMock) -> None:
        self._configure_settings(mock_settings)
        mock_call.return_value = json.dumps(["Alpha", "alpha ", "ALPHA", "Beta", "Gamma"])
        service = QueryExpansionService()
        result = service.generate_queries("music")
        self.assertEqual(result, ["Alpha", "Beta", "Gamma"])
        mock_call.assert_called_once()

    @patch.object(QueryExpansionService, "_call_openai")
    @patch("functions.runtime.services.query_expansion.settings")
    def test_generate_queries_retries_when_dedup_leaves_too_few(
        self, mock_settings: MagicMock, mock_call: MagicMock
    ) -> None:
        self._configure_settings(mock_settings)
        mock_call.side_effect = [
            json.dumps(["Solo", "solo", "SOLO"]),
            json.dumps(["Solo", "solo", "SOLO"]),
            json.dumps(["Solo", "solo", "SOLO"]),
        ]
        service = QueryExpansionService()
        result = service.generate_queries("boutique")
        self.assertEqual(result, ["boutique"])
        self.assertEqual(mock_call.call_count, 3)

    @patch("functions.runtime.services.query_expansion.OpenAI")
    @patch("functions.runtime.services.query_expansion.settings")
    def test_call_openai_uses_openai_client(
        self,
        mock_settings: MagicMock,
        mock_openai: MagicMock,
    ) -> None:
        mock_settings.OPENAI_API_KEY = None
        service = QueryExpansionService(openai_api_key="override-key", temperature=0.9)

        mock_client = MagicMock()
        response = MagicMock()
        response.output_text = "  [\"alpha\"]  "
        mock_client.responses.create.return_value = response
        mock_openai.return_value = mock_client

        output = service._call_openai("prompt")

        self.assertEqual(output, "[\"alpha\"]")
        mock_openai.assert_called_once_with(api_key="override-key")
        mock_client.responses.create.assert_called_once()
        call_kwargs = mock_client.responses.create.call_args.kwargs
        self.assertEqual(call_kwargs.get("temperature"), 0.9)


if __name__ == "__main__":
    unittest.main()
