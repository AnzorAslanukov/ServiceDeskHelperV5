import sys
import os
import json

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from services.athena import Athena
from services.output import Output

# Global debug flag - set to True to enable logging to output.txt
DEBUG = False


class KeywordMatch:
    """
    Production class for keyword matching functionality.
    Provides methods to match locations and support groups against ticket data.
    """

    def __init__(self):
        """
        Initialize KeywordMatch with Athena client and Output handler.
        """
        self.athena = Athena() 
        self.output = Output() 

    def match_locations(self, ticket_data):
        """
        Match locations against ticket data retrieved from get_ticket_data.

        Args:
            ticket_data: Ticket data returned by Athena.get_ticket_data()

        Returns:
            dict: Dictionary with keys 'user_location' and 'incident_location'
                  containing the matched category or 'none' if no match found
        """
        if DEBUG:
            self.output.add_line("match_locations method called with ticket data")

        # Load locations data
        locations_path = os.path.join(os.path.dirname(__file__), 'locations.json')
        with open(locations_path, 'r') as f:
            locations_data = json.load(f)

        user_location = "none"
        incident_location = "none"

        # Step 1: Check location for incident location
        if ticket_data and 'location' in ticket_data and ticket_data['location']:
            location_value = ticket_data['location']
            # Handle both string values and dict structures
            if isinstance(location_value, str):
                location_ticket_number = location_value
            elif isinstance(location_value, dict):
                location_ticket_number = location_value.get('ticket_number')
            else:
                location_ticket_number = None

            if location_ticket_number and location_ticket_number != "Remote User":
                # Search for this value in locations.json
                for location in locations_data.get('locations', []):
                    for site in location.get('sites', []):
                        if site.get('name') == location_ticket_number:
                            incident_location = location.get('category', 'none')
                            break
                    if incident_location != "none":
                        break

        # Step 2: Check affectedUser.company for user location
        if ticket_data and 'affectedUser' in ticket_data and ticket_data['affectedUser']:
            company = ticket_data['affectedUser'].get('company')
            if company:
                # Search for this company in locations.json
                for location in locations_data.get('locations', []):
                    # Check if company matches category (case-insensitive)
                    if company.lower() == location.get('category', '').lower():
                        user_location = location.get('category', 'none')
                        break
                    # Check if company is contained in site names (case-insensitive)
                    for site in location.get('sites', []):
                        site_name = site.get('name', '')
                        if company.lower() in site_name.lower():
                            user_location = location.get('category', 'none')
                            break
                    if user_location != "none":
                        break

        # Step 3: Check affectedUser.streetAddress for user location (if still none)
        if user_location == "none" and ticket_data and 'affectedUser' in ticket_data and ticket_data['affectedUser']:
            street_address = ticket_data['affectedUser'].get('streetAddress')
            if street_address:
                # Search for this address in locations.json site names
                for location in locations_data.get('locations', []):
                    for site in location.get('sites', []):
                        site_name = site.get('name', '')
                        # Check if street_address is contained in site_name (case-insensitive)
                        if street_address.lower() in site_name.lower():
                            user_location = location.get('category', 'none')
                            break
                    if user_location != "none":
                        break

        result = {
            "user_location": user_location,
            "incident_location": incident_location
        }

        if DEBUG:
            self.output.add_line(f"Location match result: {result}")
        return result

    def match_support_groups(self, ticket_data, exclude_keywords=None):
        """
        Match support groups against ticket data retrieved from get_ticket_data.

        Args:
            ticket_data: Ticket data returned by Athena.get_ticket_data()
            exclude_keywords (list, optional): List of keyword strings to exclude from global_support.
                                               Support groups whose name contains any of these keywords
                                               will be removed from global_support results.

        Returns:
            dict: Dictionary with keys 'location_specific_support' and 'global_support'
                  containing lists of matched support group records
        """
        if DEBUG:
            self.output.add_line("match_support_groups method called with ticket data")

        # Determine ticket type from ticket ID
        ticket_type = "ir"  # default
        if ticket_data and 'id' in ticket_data:
            ticket_id = ticket_data['id']
            if ticket_id.startswith('SR'):
                ticket_type = "sr"
            elif ticket_id.startswith('IR'):
                ticket_type = "ir"

        # Load support group data
        support_groups_path = os.path.join(os.path.dirname(__file__), 'support_group_description.json')
        with open(support_groups_path, 'r') as f:
            support_groups_data = json.load(f)

        # Load support group keywords data
        keywords_path = os.path.join(os.path.dirname(__file__), 'support_group_keywords.json')
        with open(keywords_path, 'r') as f:
            keywords_data = json.load(f)

        # Create mapping from support group name to keywords
        sg_keywords_map = {}
        for kw_entry in keywords_data:
            sg_keywords_map[kw_entry['name']] = kw_entry.get('keywords', [])

        # Load locations data to get all categories for exclusion check
        locations_path = os.path.join(os.path.dirname(__file__), 'locations.json')
        with open(locations_path, 'r') as f:
            locations_data = json.load(f)

        # Get all unique location categories
        all_location_categories = set()
        for location in locations_data.get('locations', []):
            category = location.get('category', '')
            if category:
                all_location_categories.add(category.lower())

        # Get location matches from match_locations
        location_matches = self.match_locations(ticket_data)
        location_keywords = set()
        for loc in [location_matches.get('user_location'), location_matches.get('incident_location')]:
            if loc and loc != 'none':
                location_keywords.add(loc.lower())

        # Filter location-specific support groups
        location_specific_support = []
        remaining_support_groups = []

        for sg in support_groups_data:
            name = sg.get('name', '').lower()
            sg_ticket_type = sg.get('ticket_type')
            description = sg.get('description')

            # Check if this support group matches location keywords
            is_location_specific = False
            for keyword in location_keywords:
                if keyword in name:
                    is_location_specific = True
                    break

            if is_location_specific and sg_ticket_type == ticket_type and description is not None:
                location_specific_support.append(sg)
            elif sg_ticket_type == ticket_type and description is not None:
                remaining_support_groups.append(sg)

        # Filter global support groups (exclude those that contain any location category)
        global_support = []
        for sg in remaining_support_groups:
            name = sg.get('name', '').lower()
            is_location_related = False
            for category in all_location_categories:
                if category in name:
                    is_location_related = True
                    break
            if not is_location_related:
                global_support.append(sg)

        # Apply additional exclusion filtering on global_support if exclude_keywords provided
        if exclude_keywords:
            filtered_global_support = []
            for sg in global_support:
                name = sg.get('name', '').lower()
                should_exclude = False
                for keyword in exclude_keywords:
                    if keyword.lower() in name:
                        should_exclude = True
                        break
                if not should_exclude:
                    filtered_global_support.append(sg)
            global_support = filtered_global_support

        # Apply keyword-based filtering on global_support using support_group_keywords.json
        # Extract ticket content for keyword matching
        ticket_content_fields = []
        if ticket_data:
            ticket_content_fields.append(ticket_data.get('title', ''))
            ticket_content_fields.append(ticket_data.get('display_name', ''))
            ticket_content_fields.append(ticket_data.get('description', ''))

            if ticket_data.get('affectedUser'):
                ticket_content_fields.append(ticket_data['affectedUser'].get('title', ''))

        # Combine all ticket content into a single string for searching
        ticket_content = ' '.join(ticket_content_fields).lower()

        # Filter global_support based on keyword matches
        keyword_filtered_global_support = []
        for sg in global_support:
            sg_name = sg.get('name', '')
            sg_keywords = sg_keywords_map.get(sg_name, [])

            # If support group has no keywords defined, exclude it
            if not sg_keywords:
                continue

            # Check if any keyword appears in ticket content
            has_keyword_match = False
            for keyword in sg_keywords:
                if keyword.lower() in ticket_content:
                    has_keyword_match = True
                    break

            # Only keep support groups that have keyword matches
            if has_keyword_match:
                keyword_filtered_global_support.append(sg)

        global_support = keyword_filtered_global_support

        result = {
            "location_specific_support": location_specific_support,
            "global_support": global_support
        }

        if DEBUG:
            self.output.add_line(f"Support group match result: {len(location_specific_support)} location-specific, {len(global_support)} global support groups")
        return result