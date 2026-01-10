# services/field_mapping.py

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
