class ParseJson:
    """
    Class for parsing JSON outputs from Athena API into human-legible formats.
    """

    def __init__(self):
        """
        Initialize the ParseJson parser.
        """
        pass

    def parse_object(self, json_obj):
        """
        Generic method to parse a JSON object into human-legible formats.
        json_obj: The JSON object to parse
        Returns: Parsed human-readable representation (to be implemented later)
        """
        # Handle query result with columns
        if isinstance(json_obj, dict) and 'data' in json_obj:
            columns = json_obj.get('columns', [])
            structured_data = []
            for row in json_obj.get('data', []):
                if not columns and row:
                    # Use actual field names for the 33 fields
                    default_fields = ['TicketType', 'Location', 'Floor', 'Room', 'CreatedDate', 'ResolvedDate', 'Priority', 'Id', 'Title', 'Description', 'SupportGroup', 'Source', 'Status', 'Impact', 'Urgency', 'AssignedToUserName', 'AffectedUserName', 'LastModifiedDate', 'Escalated', 'First_Call_Resolution', 'Classification/Area', 'ResolutionCategory', 'ResolutionNotes', 'CommandCenter', 'ConfirmedResolution', 'Increments', 'FeedbackValue', 'Feedback_Notes', 'Tags', 'Specialty', 'Next_Steps', 'User_Assign_Change', 'Support_Group_Change']
                    columns = default_fields[:len(row)]  # In case fewer fields, but assume 33
                row_dict = dict(zip(columns, row))
                structured_data.append(row_dict)
            return self._format_dict({
                'status': json_obj.get('status'),
                'count': json_obj.get('count'),
                'data': structured_data
            }, indent=0)
        else:
            # Default handling
            if isinstance(json_obj, dict):
                return self._format_dict(json_obj, indent=0)
            elif isinstance(json_obj, list):
                return self._format_list(json_obj, indent=0)
            else:
                return str(json_obj)

    def _format_dict(self, data, indent=0):
        """
        Helper method to format dictionary into readable text.
        """
        lines = []
        prefix = "  " * indent
        for key, value in data.items():
            if isinstance(value, dict):
                lines.append(f"{prefix}{key}:")
                lines.append(self._format_dict(value, indent + 1))
            elif isinstance(value, list):
                lines.append(f"{prefix}{key}:")
                lines.append(self._format_list(value, indent + 1))
            else:
                val_str = str(value)
                if isinstance(value, str) and len(val_str) > 100:
                    val_str = val_str[:100] + "..."
                lines.append(f"{prefix}{key}: {val_str}")
        return "\n".join(lines)

    def _format_list(self, data, indent=0):
        """
        Helper method to format list into readable text.
        """
        lines = []
        prefix = "  " * indent
        for i, item in enumerate(data):
            if isinstance(item, dict):
                lines.append(f"{prefix}[{i}]:")
                lines.append(self._format_dict(item, indent + 1))
            elif isinstance(item, list):
                lines.append(f"{prefix}[{i}]:")
                lines.append(self._format_list(item, indent + 1))
            else:
                lines.append(f"{prefix}[{i}]: {item}")
        return "\n".join(lines)
