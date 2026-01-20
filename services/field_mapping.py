# services/field_mapping.py

import re
import os
import requests
from output import Output

# Athena import moved inside get_guid method to avoid circular import

# Global logging configuration
DEBUG_LOGGING = True  # Set to False to disable logging

# Global field mapping dictionaries to standardize field names across data sources
# Athena API uses camelCase, Databricks uses PascalCase, we standardize to snake_case

ATHENA_TO_STANDARD = {
    # Core identifiers
    'id': 'id',
    'name': 'ticket_number',
    'entityId': 'entity_id',
    'entityType': 'entity_type',

    # Standard fields
    'title': 'title',
    'description': 'description',
    'displayName': 'display_name',

    # Priority/Status (API has both ID and Value, we prefer Value)
    'priority': 'priority_level',
    'priorityValue': 'priority',
    'status': 'status_id',
    'statusValue': 'status',
    'impact': 'impact_id',
    'impactValue': 'impact',
    'urgency': 'urgency_id',
    'urgencyValue': 'urgency',

    # Dates
    'createdDate': 'created_at',
    'completedDate': 'completed_at',
    'resolvedDate': 'resolved_at',
    'closedDate': 'closed_at',
    'lastModified': 'last_modified_at',

    # Location
    'location': 'location_id',
    'locationValue': 'location',
    'floor': 'floor_id',
    'floorValue': 'floor',
    'room': 'room',

    # Assignment
    'assignedTo_EntityId': 'assigned_to_entity_id',
    'assignedTo_DisplayName': 'assigned_to',
    'assignedTo_Department': 'assigned_to_department',
    'assignedTo_Title': 'assigned_to_title',
    'assignedTo_UserName': 'assigned_to_username',
    'assignedTo_Company': 'assigned_to_company',

    # Affected User
    'affectedUser_EntityId': 'affected_user_entity_id',
    'affectedUser_DisplayName': 'affected_user',
    'affectedUser_Department': 'affected_user_department',
    'affectedUser_Title': 'affected_user_title',
    'affectedUser_UserName': 'affected_user_username',

    # Created By
    'createdBy_DisplayName': 'created_by',
    'createdBy_Department': 'created_by_department',
    'createdBy_Title': 'created_by_title',

    # Other values
    'source': 'source_id',
    'sourceValue': 'source',
    'supportGroup': 'support_group_id',
    'supportGroupValue': 'support_group',
    'tierQueue': 'tier_queue',
    'contactMethod': 'contact_method',

    # Flags
    'escalated': 'escalated',
    'isParent': 'is_parent',

    # Classification
    'classification': 'classification_id',
    'classificationValue': 'classification',

    # Command Center
    'command_Center': 'command_center_id',
    'command_CenterValue': 'command_center',
}

DATABRICKS_TO_STANDARD = {
    # Core identifiers
    'Id': 'id',
    'TicketType': 'entity_type',

    # Standard fields
    'Title': 'title',
    'Description': 'description',

    # Status/Priority
    'Status': 'status',
    'Priority': 'priority',
    'Impact': 'impact',
    'Urgency': 'urgency',

    # Dates
    'CreatedDate': 'created_at',
    'ResolvedDate': 'resolved_at',
    'LastModifiedDate': 'last_modified_at',

    # Location
    'Location': 'location', 
    'Floor': 'floor', 
    'Room': 'room', 

    # Assignment
    'AssignedToUserName': 'assigned_to',
    'AffectedUserName': 'affected_user',

    # Support details
    'SupportGroup': 'support_group',
    'Source': 'source',
    'ResolutionCategory': 'resolution_category',
    'ResolutionNotes': 'resolution_notes',
    'Classification/Area': 'classification',

    # Additional Databricks fields
    'LastModifiedDate': 'last_modified_at',
    'Escalated': 'escalated',
    'First_Call_Resolution': 'first_call_resolution',
    'CommandCenter': 'command_center',
    'ConfirmedResolution': 'confirmed_resolution',
    'Increments': 'increments',
    'FeedbackValue': 'feedback_value',
    'Feedback_Notes': 'feedback_notes',
    'Tags': 'tags',
    'Specialty': 'specialty',
    'Next_Steps': 'next_steps',
    'User_Assign_Change': 'user_assign_change',
    'Support_Group_Change': 'support_group_change',
}

class FieldMapper:
    """
    Utility class for normalizing field names between data sources.
    """

    output = Output()  # Class-level output instance for logging

    @staticmethod
    def normalize_athena_data(data):
        """
        Convert Athena API response field names to standardized names.

        Args:
            data: Dictionary or list from Athena API

        Returns:
            Data with standardized field names
        """
        if isinstance(data, dict):
            normalized = {}
            for key, value in data.items():
                # Recursively normalize nested structures
                if isinstance(value, (dict, list)):
                    value = FieldMapper.normalize_athena_data(value)
                # Map field name using the mapping dictionary
                standard_key = ATHENA_TO_STANDARD.get(key, key)  # Fall back to original key if not mapped
                normalized[standard_key] = value
            return normalized
        elif isinstance(data, list):
            return [FieldMapper.normalize_athena_data(item) for item in data]
        return data

    @staticmethod
    def normalize_databricks_data(data):
        """
        Convert Databricks table row field names to standardized names.

        Args:
            data: Dictionary from Databricks query result

        Returns:
            Data with standardized field names
        """
        if isinstance(data, dict):
            normalized = {}
            for key, value in data.items():
                # Recursively normalize nested structures (though Databricks is typically flat)
                if isinstance(value, (dict, list)):
                    value = FieldMapper.normalize_databricks_data(value)
                # Map field name using the mapping dictionary
                standard_key = DATABRICKS_TO_STANDARD.get(key, key)  # Fall back to original key if not mapped
                normalized[standard_key] = value
            return normalized
        elif isinstance(data, list):
            return [FieldMapper.normalize_databricks_data(item) for item in data]
        return data

    @staticmethod
    def get_standard_fields():
        """
        Get all unique standard field names across both mappings.

        Returns:
            Set of standard field names
        """
        standard_fields = set(ATHENA_TO_STANDARD.values())
        standard_fields.update(DATABRICKS_TO_STANDARD.values())
        return standard_fields

    @staticmethod
    def _build_enum_mappings(items, name_to_guid=None, guid_to_name=None, prefix=""):
        """
        Recursively build bidirectional mappings from enum tree structure.

        Args:
            items: List of enum items from API response
            name_to_guid: Dict to populate name -> guid mappings
            guid_to_name: Dict to populate guid -> name mappings
            prefix: Current hierarchical prefix for fullname
        """
        if name_to_guid is None:
            name_to_guid = {}
        if guid_to_name is None:
            guid_to_name = {}

        for item in items:
            guid = item.get('value')
            label = item.get('label')
            fullname = item.get('fullname')

            if guid and label:
                # Map using fullname (hierarchical path) as primary key, fallback to label
                primary_name = fullname if fullname else label

                # Store mappings
                name_to_guid[primary_name] = guid
                name_to_guid[label] = guid  # Also allow lookup by just label
                guid_to_name[guid] = primary_name

            # Recursively process children
            children = item.get('children', [])
            if children:
                child_prefix = f"{label}\\" if label else ""
                FieldMapper._build_enum_mappings(children, name_to_guid, guid_to_name, child_prefix)

        return name_to_guid, guid_to_name

    @staticmethod
    def get_guid(value, ticket_type="ir"):
        """
        Bidirectional lookup between support group names and GUIDs from Athena API.

        Args:
            value (str): Either a support group name or GUID
            ticket_type (str): "ir" for IR support groups, "sr" for SR support groups

        Returns:
            str: The corresponding GUID if name provided, or name if GUID provided.
                 Returns None if no match found or error occurred.
        """
        if DEBUG_LOGGING:
            FieldMapper.output.add_line(f"Starting get_guid lookup for value: {value}, ticket_type: {ticket_type}")

        # Determine endpoint based on ticket type
        if ticket_type.lower() == "ir":
            endpoint = os.getenv('ATHENA_IR_SUPPORT_GROUP_GUID')
        elif ticket_type.lower() == "sr":
            endpoint = os.getenv('ATHENA_SR_SUPPORT_GROUP_GUID')
        else:
            if DEBUG_LOGGING:
                FieldMapper.output.add_line("Invalid ticket_type. Must be 'ir' or 'sr'")
            return None

        if not endpoint:
            if DEBUG_LOGGING:
                FieldMapper.output.add_line(f"Missing endpoint configuration for {ticket_type.upper()}")
            return None

        # Detect if input is GUID using regex
        guid_pattern = r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        is_guid = bool(re.match(guid_pattern, value, re.IGNORECASE))

        if DEBUG_LOGGING:
            FieldMapper.output.add_line(f"Detected input as: {'GUID' if is_guid else 'string'}")
            FieldMapper.output.add_line(f"Using endpoint: {endpoint}")

        # Get authentication token (local import to avoid circular import)
        from services.athena import Athena
        athena_client = Athena()
        token = athena_client.get_token()

        if not token:
            if DEBUG_LOGGING:
                FieldMapper.output.add_line("Failed to obtain authentication token")
            return None

        if DEBUG_LOGGING:
            FieldMapper.output.add_line("Authentication successful")

        # Make API request
        headers = {
            'Authorization': f'Bearer {token}'
        }

        try:
            response = requests.get(endpoint, headers=headers, timeout=30)

            if DEBUG_LOGGING:
                FieldMapper.output.add_line(f"API request status: {response.status_code}")

            if response.status_code == 200:
                data = response.json()
                if DEBUG_LOGGING:
                    FieldMapper.output.add_line(f"API call successful, processing {len(data)} root items")

                # Build bidirectional mappings from the tree structure
                name_to_guid, guid_to_name = FieldMapper._build_enum_mappings(data)

                if DEBUG_LOGGING:
                    FieldMapper.output.add_line(f"Built mappings: {len(name_to_guid)} name->guid, {len(guid_to_name)} guid->name")

                # Perform lookup based on input type
                if is_guid:
                    result = guid_to_name.get(value)
                    lookup_type = "GUID to name"
                else:
                    result = name_to_guid.get(value)
                    lookup_type = "name to GUID"

                if DEBUG_LOGGING:
                    if result:
                        FieldMapper.output.add_line(f"Lookup result ({lookup_type}): {result}")
                    else:
                        FieldMapper.output.add_line(f"No matching value found for {lookup_type} lookup")

                return result

            else:
                if DEBUG_LOGGING:
                    FieldMapper.output.add_line(f"API request failed: {response.status_code} - {response.text}")
                return None

        except requests.exceptions.RequestException as e:
            if DEBUG_LOGGING:
                FieldMapper.output.add_line(f"Network error during API call: {str(e)}")
            return None
        except Exception as e:
            if DEBUG_LOGGING:
                FieldMapper.output.add_line(f"Unexpected error in get_guid: {str(e)}")
            return None
