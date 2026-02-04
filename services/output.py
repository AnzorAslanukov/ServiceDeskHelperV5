class Output:
    def __init__(self, clear_on_init=False):
        """
        Initialize Output class.
        clear_on_init: If True, clears output.txt on initialization
        """
        if clear_on_init:
            with open("output.txt", "w", encoding='utf-8') as f:
                pass  # Create/empty file

    def add_line(self, line):
        """
        Appends a line of text to output.txt, followed by newline.
        line: String to add
        """
        with open("output.txt", "a", encoding='utf-8') as f:
            f.write(line + "\n")
