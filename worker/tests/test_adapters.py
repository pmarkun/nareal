import unittest
from adapters import parse_vtt, input_adapter, OBSInput, YouTubeInput, InputError

class AdapterTests(unittest.TestCase):
    def test_rolling_captions_and_voice(self):
        text = 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n<v Ana>Um dado</v>\n\n00:00:02.500 --> 00:00:05.000\n<v Ana>Um dado importante</v>\n\n00:00:05.000 --> 00:00:07.000\n<v Bruno>Outra fala</v>'
        segments = parse_vtt(text)
        self.assertEqual([s['text'] for s in segments], ['Um dado', 'importante', 'Outra fala'])
        self.assertEqual(segments[2]['speaker'], 'Bruno')
        self.assertEqual(segments[2]['start'], 5)
    def test_spoken_repetition_after_gap_is_preserved(self):
        text = '00:01.000 --> 00:02.000\nSim\n\n00:03.000 --> 00:04.000\nSim'
        self.assertEqual(len(parse_vtt(text)), 2)
        self.assertEqual(parse_vtt(text)[0]['speaker'], 'Falante não identificado')
    def test_adapters_are_independent_from_model(self):
        self.assertIsInstance(input_adapter('youtube'), YouTubeInput)
        self.assertIsInstance(input_adapter('obs'), OBSInput)
        with self.assertRaises(InputError): input_adapter('unknown')

if __name__ == '__main__': unittest.main()
